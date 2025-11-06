# アーキテクチャ

## 概要

Search MCP Serverは、**MCPアグリゲーター**として設計された、複数のMCPサーバーを統合管理するサーバーです。Model Context Protocol (MCP) の理念に基づき、プログレッシブな開示によってAIクライアントのコンテキスト消費を70-80%削減します。

## 設計原則

### 1. MCPアグリゲーションパターン

Search MCPは、複数のMCPサーバーを束ね、単一のエンドポイントとしてAIクライアントに提供します：

```
┌─────────────────────────────────────────────┐
│   AIクライアント (Claude/Cursor/Windsurf)   │
│                                             │
│   従来: 4個のMCPサーバーに個別接続          │
│   → 23,000トークン消費                      │
│                                             │
│   Search MCP: 1個のMCPサーバーのみ接続      │
│   → 6,000トークン消費 (75%削減)            │
└──────────────────┬──────────────────────────┘
                   │ MCP Protocol (stdio)
                   ↓
┌─────────────────────────────────────────────┐
│       Search MCP Server (アグリゲーター)    │
│                                             │
│  ┌──────────────────────────────────────┐  │
│  │  MCP Client Manager                  │  │
│  │  - 複数MCPサーバーの統合管理         │  │
│  │  - stdio通信でMCPサーバーと接続      │  │
│  │  - ツール情報の集約                  │  │
│  └──────────────────────────────────────┘  │
│                                             │
│  ┌──────────────────────────────────────┐  │
│  │  Tool Registry                       │  │
│  │  - 軽量なメタデータ管理              │  │
│  │  - プログレッシブな開示              │  │
│  └──────────────────────────────────────┘  │
└──────┬────────┬────────┬────────┬──────────┘
       │        │        │        │
       │ stdio  │ stdio  │ stdio  │ stdio
       ↓        ↓        ↓        ↓
┌──────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│filesystem│ │ brave  │ │database│ │ slack  │
│   MCP    │ │  MCP   │ │  MCP   │ │  MCP   │
│(50 tools)│ │(20)    │ │(30)    │ │(15)    │
└──────────┘ └────────┘ └────────┘ └────────┘
```

### 2. プログレッシブな開示 (Progressive Disclosure)

AIクライアントは段階的に情報を取得します：

**Phase 1: 初期読み込み（軽量）**
```
Client → Search MCP: tools/list
       ← ツール名とサーバー名のみ
       ← 115 tools × 50トークン = 5,750トークン
```

**Phase 2: 詳細取得（必要時のみ）**
```
Client → Search MCP: tools/get filesystem.read_file
       ← 詳細なパラメータ情報
       ← 1 tool × 200トークン = 200トークン
```

**Phase 3: 実行**
```
Client → Search MCP: tools/call filesystem.read_file {path: "..."}
       → filesystem MCP: 実行依頼
       ← filesystem MCP: 結果
       ← Client: 結果
```

**合計コンテキスト消費: 約6,000トークン (従来比75%削減)**

## コンポーネント

### 1. MCP Client Manager (`src/mcp/mcp-client-manager.ts`)

複数のMCPサーバーを統合管理するコアコンポーネント。

**責務:**
- 設定ファイル (`config/mcp-servers.json`) の読み込み
- 複数MCPサーバーのプロセス起動・停止
- 各MCPサーバーとのstdio通信管理
- ツール情報の集約
- ヘルスチェックと自動再接続

**主要メソッド:**
```typescript
loadConfig(configPath: string): Promise<void>
startAll(): Promise<void>
start(name: string): Promise<void>
stop(name: string): Promise<void>
listAllTools(): Promise<AggregatedToolMetadata[]>
executeTool(serverName: string, toolName: string, parameters): Promise<any>
healthCheck(): Promise<Record<string, boolean>>
```

### 2. MCP Client (`src/mcp/mcp-client.ts`)

個別のMCPサーバーとの通信を担当。

**責務:**
- MCPサーバープロセスの起動
- stdio経由のMCPプロトコル通信
- `initialize`, `tools/list`, `tools/call` メソッドの実装
- エラーハンドリングと再接続

**主要メソッド:**
```typescript
connect(): Promise<void>
disconnect(): Promise<void>
listTools(): Promise<ToolMetadata[]>
executeTool(toolName: string, parameters): Promise<any>
ping(): Promise<void>
```

**MCPプロトコル実装例:**
```typescript
// Initialize
await sendMessage({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '1.0.0',
    clientInfo: { name: 'search-mcp', version: '1.0.0' }
  }
});

// List tools
await sendMessage({
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/list',
  params: {}
});

// Call tool
await sendMessage({
  jsonrpc: '2.0',
  id: 3,
  method: 'tools/call',
  params: {
    name: 'read_file',
    arguments: { path: '/path/to/file' }
  }
});
```

### 3. Tool Registry (`src/tool-registry.ts`)

集約されたツール情報を管理。

**責務:**
- 各MCPサーバーから取得したツール情報の統合
- 軽量なメタデータの提供
- ツール名の名前空間管理 (`serverName.toolName`)

**主要メソッド:**
```typescript
aggregateTools(mcpManager: MCPClientManager): Promise<void>
list(): LightweightToolMetadata[]
get(toolName: string): DetailedToolMetadata
```

### 4. MCP Server (`src/index.ts`)

Search MCP自身のMCPサーバー実装。AIクライアント（Claude等）からの接続を受け付けます。

**提供するMCPメソッド:**
- `initialize`: クライアント接続の初期化
- `tools/list`: 集約されたツール一覧を返す（軽量版）
- `tools/call`: 指定されたツールを実行（該当MCPサーバーへプロキシ）

### 5. 設定ファイル (`config/mcp-servers.json`)

接続するMCPサーバーの定義。

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
      "env": { ... },
      "enabled": true
    }
  }
}
```

## データフロー

### ツール一覧取得フロー（軽量版）

```
┌─────────┐                ┌────────────┐              ┌─────────────┐
│ Claude  │                │ Search MCP │              │ filesystem  │
│ Desktop │                │   Server   │              │    MCP      │
└────┬────┘                └─────┬──────┘              └──────┬──────┘
     │                           │                            │
     │ tools/list                │                            │
     ├──────────────────────────>│                            │
     │                           │ (初回のみ) tools/list      │
     │                           ├───────────────────────────>│
     │                           │<───────────────────────────┤
     │                           │ {tools: [...50 tools...]}  │
     │                           │                            │
     │  軽量版ツールリスト         │                            │
     │<──────────────────────────┤                            │
     │ {tools: [                 │                            │
     │   {name: "filesystem.read_file", ...}, // 詳細除外   │
     │   ...                     │                            │
     │ ]}                        │                            │
     │                           │                            │
```

**ポイント**:
- 初回のみ各MCPサーバーから完全なツール情報を取得
- Claude Desktopには軽量なメタデータのみ返す
- パラメータ詳細は省略（必要時のみ取得）

### ツール実行フロー

```
┌─────────┐                ┌────────────┐              ┌─────────────┐
│ Claude  │                │ Search MCP │              │ filesystem  │
│ Desktop │                │   Server   │              │    MCP      │
└────┬────┘                └─────┬──────┘              └──────┬──────┘
     │                           │                            │
     │ tools/call                │                            │
     │ filesystem.read_file      │                            │
     │ {path: "/path/to/file"}   │                            │
     ├──────────────────────────>│                            │
     │                           │ tools/call                 │
     │                           │ read_file                  │
     │                           │ {path: "/path/to/file"}    │
     │                           ├───────────────────────────>│
     │                           │                            │
     │                           │   {content: "..."}         │
     │                           │<───────────────────────────┤
     │                           │                            │
     │  {content: "..."}         │                            │
     │<──────────────────────────┤                            │
     │                           │                            │
```

**ポイント**:
- Search MCPは該当するMCPサーバーへリクエストをプロキシ
- ツール名は `serverName.toolName` 形式で管理
- 結果はそのままClaude Desktopへ返す

## 技術スタック

- **ランタイム**: Node.js 18+
- **言語**: TypeScript 5.9+
- **プロトコル**: MCP (Model Context Protocol) - stdio通信
- **プロセス管理**: child_process (spawn)
- **JSON-RPC**: 2.0準拠

### 選定理由

**Node.js + TypeScript**:
- 非同期I/Oに優れ、複数MCPサーバーとの並行通信に適している
- stdio通信の実装が容易
- 型安全性による保守性の向上

**stdio通信**:
- MCPプロトコルの標準通信方式
- プロセス間通信として軽量かつ確実
- デバッグが容易

## 拡張性

### 新しいMCPサーバーの追加

設定ファイルに追記するだけ：

```json
{
  "mcpServers": {
    "new-mcp": {
      "command": "npx",
      "args": ["-y", "new-mcp-server"]
    }
  }
}
```

再起動すれば自動的に統合されます。

### 対応MCPサーバー

MCP仕様に準拠したすべてのサーバーに対応：
- stdio通信をサポート
- `tools/list`と`tools/call`メソッドを実装
- JSON-RPC 2.0形式

## パフォーマンス特性

### コンテキスト削減効果

| 項目 | 従来 | Search MCP | 削減率 |
|------|------|-----------|--------|
| 初期読み込み | 23,000トークン | 5,750トークン | **75%削減** |
| ツール詳細取得 | - | 200トークン/ツール | 必要時のみ |
| 合計（3ツール使用時） | 23,000トークン | 6,350トークン | **72%削減** |

### レスポンスタイム目標

- MCP初期化: < 1秒
- ツール一覧取得: < 100ms
- ツール実行: バックエンドMCPサーバー依存 + 数ms（プロキシオーバーヘッド）

### メモリフットプリント

- 基本メモリ: < 50MB
- MCPサーバー毎: 追加 20-30MB
- 4つのMCPサーバー接続時: 約150MB

## セキュリティ考慮事項

### MCPサーバー管理

- 設定ファイルで管理するMCPサーバーのみを信頼
- 不正なコマンド実行を防ぐため、設定ファイルへのアクセス制御が重要
- 環境変数はプロセス実行時に展開され、ログに記録されない

### 今後の改善

- MCPサーバー間の通信暗号化（オプション）
- MCPサーバーのサンドボックス化
- レート制限（AIクライアント側）
- 監査ログ

## 将来の拡張

### Phase 2: 検索機能強化
- ツール名での部分一致検索
- タグ・カテゴリベースのフィルタリング

### Phase 3: セキュリティ強化
- API認証・認可
- レート制限
- 監査ログ

### Phase 4: 高度な機能
- ホットリロード（設定変更時の再起動不要）
- セマンティック検索（ベクトル検索）
- ツール使用統計・分析

### Phase 5: Web管理UI（オプション）
- MCPサーバーの管理画面
- ツール使用状況のダッシュボード
- リアルタイム監視

## 関連ドキュメント

- [MCPアグリゲーター設計](design/08-mcp-aggregator.md) - 実装の詳細
- [セットアップガイド](design/07-simplified-setup.md) - 設定方法
- [MCP概念](mcp-concepts.md) - MCPの基本概念
- [詳細設計](design/) - すべての設計ドキュメント
