# Model Context Protocol (MCP) の概念

## 概要

Model Context Protocol (MCP) は、Anthropicが提唱する、AIエージェントがツールや外部リソースと効率的に連携するためのプロトコルです。

**Search MCP Server**は、複数のMCPサーバーを統合管理する**MCPアグリゲーター**として設計されており、AIクライアント（Claude Desktop、Cursor、Windsurf等）のコンテキスト消費を70-80%削減します。

このドキュメントでは、MCPの基本概念と、Search MCP ServerにおけるMCPアグリゲーションパターンの実装について説明します。

## 背景と課題

### AIクライアントが直面する課題

1. **コンテキストウィンドウの制限**
   - AIモデルには処理できるトークン数に上限がある
   - 複数のMCPサーバー（filesystem、brave-search、database等）を個別に接続すると、各サーバーのツール情報でコンテキストが圧迫される
   - 例: 4つのMCPサーバー（計115ツール）で約23,000トークンを消費

2. **ツールの発見性**
   - 多数のMCPサーバーから提供されるツールから、適切なものを素早く見つける必要がある
   - 各MCPサーバーが個別のツール情報を提供するため、統合的な検索が困難

3. **設定管理の複雑さ**
   - 各MCPサーバーを個別に設定・管理する必要がある
   - AIクライアント（Claude Desktop、Cursor、Windsurf）ごとに同じ設定を繰り返す手間

### Search MCPによる解決

**MCPアグリゲーターパターン**により、これらの課題を解決：
- 複数のMCPサーバーを1つのエンドポイントに集約
- プログレッシブな開示により、コンテキスト消費を75%削減（23,000 → 6,000トークン）
- 1つの設定ファイルで複数のMCPサーバーを一元管理

## MCPの基本原則

### 1. プログレッシブな開示 (Progressive Disclosure)

**概念**: 情報を段階的に提供し、必要なものだけを詳細に読み込む

**実装**:
```
Step 1: ツール一覧取得（軽量なメタデータのみ）
  → AIはツール名と説明からどのツールを使うか判断

Step 2: 選択したツールの実行（詳細な処理）
  → 必要なツールのみを実行し、結果を取得
```

**メリット**:
- コンテキスト消費を最小化
- レスポンス時間の短縮
- スケーラビリティの向上

### 2. ツールのメタデータ管理

**概念**: ツールの情報を構造化し、検索可能にする

**メタデータの要素**:
- **名前**: ツールの一意な識別子
- **説明**: ツールが何をするかの簡潔な説明
- **パラメータ**: 必要な入力とその型、説明

**例**:
```json
{
  "name": "search",
  "description": "テキストを検索します",
  "parameters": [
    {
      "name": "query",
      "type": "string",
      "description": "検索クエリ",
      "required": true
    }
  ]
}
```

### 3. 外部実行環境との連携

**概念**: AIが生成したコードや複雑な処理を安全な外部環境で実行

**利点**:
- セキュリティの向上（サンドボックス化）
- リソース管理の柔軟性
- 長時間実行タスクの対応

**実装パターン**:
- コンテナ化（Docker, Kubernetes）
- サーバーレス関数（AWS Lambda, Cloud Functions）
- 専用のコード実行環境

## MCPアグリゲーターアーキテクチャ

### Search MCPの基本構成

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

### MCPプロトコル通信

Search MCPは、AIクライアントとの通信にMCPプロトコル（JSON-RPC 2.0 over stdio）を使用します。

**Phase 1: 初期化**
```json
// AIクライアント → Search MCP
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "1.0.0",
    "clientInfo": { "name": "claude-desktop", "version": "1.0.0" }
  }
}
```

**Phase 2: ツール一覧取得（軽量版）**
```json
// AIクライアント → Search MCP
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}

// Search MCP → AIクライアント（軽量なメタデータのみ）
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {"name": "filesystem.read_file", "description": "..."},
      {"name": "brave.search", "description": "..."}
      // パラメータ詳細は省略
    ]
  }
}
```

**Phase 3: ツール実行（プロキシ）**
```json
// AIクライアント → Search MCP
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "filesystem.read_file",
    "arguments": { "path": "/path/to/file" }
  }
}

// Search MCP → filesystem MCP (stdio)
// filesystem MCP → Search MCP (結果)
// Search MCP → AIクライアント
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": "ファイルの内容..."
  }
}
```

## Search MCP Serverでの実装

### 設計目標

1. **MCPアグリゲーション**
   - 複数のMCPサーバーを統合管理
   - stdio通信による標準MCPプロトコル実装
   - 透過的なプロキシ動作

2. **コンテキスト削減**
   - プログレッシブな開示により75%削減
   - 軽量なツールメタデータ
   - 必要時のみ詳細情報を提供

3. **簡単な設定**
   - Claude Desktopと同じJSON設定形式
   - コピー&ペーストで即座に利用可能
   - 最小限の学習コスト

4. **拡張性**
   - 新しいMCPサーバーの追加が容易
   - 既存のMCPサーバーをそのまま利用可能

### アーキテクチャマッピング

| MCP概念 | Search MCP Server実装 |
|---------|----------------------|
| MCP Server（自身） | `src/index.ts` - stdio通信でAIクライアントと接続 |
| MCP Client Manager | `src/mcp/mcp-client-manager.ts` - 複数MCPサーバー管理 |
| MCP Client | `src/mcp/mcp-client.ts` - 個別MCPサーバーとの通信 |
| ツール集約 | `src/tool-registry.ts` - 軽量メタデータ管理 |
| 設定管理 | `config/mcp-servers.json` - Claude Desktop互換 |

### プログレッシブな開示の実装

**Phase 1: MCPサーバーからツール情報を取得（初回のみ）**
```typescript
// MCP Client Manager
async listAllTools(): Promise<AggregatedToolMetadata[]> {
  const allTools = [];
  for (const [name, client] of this.clients) {
    const tools = await client.listTools(); // 各MCPサーバーから取得
    // 名前空間を付けて集約
    allTools.push(...tools.map(t => ({
      name: `${name}.${t.name}`,
      description: t.description
      // 詳細パラメータは保持するが、AIクライアントには送らない
    })));
  }
  return allTools;
}
```

**Phase 2: AIクライアントに軽量版を返す**
```typescript
// Search MCP Server (自身のMCP実装)
async handleToolsList(): Promise<ToolsListResult> {
  const tools = await this.mcpManager.listAllTools();
  // 軽量版メタデータのみを返す
  return {
    tools: tools.map(t => ({
      name: t.name,
      description: t.description
      // inputSchemaは含めない
    }))
  };
}
```

**Phase 3: ツール実行をプロキシ**
```typescript
// Search MCP Server
async handleToolCall(name: string, args: any): Promise<any> {
  const [serverName, toolName] = name.split('.');
  // 該当するMCPサーバーへプロキシ
  return await this.mcpManager.executeTool(serverName, toolName, args);
}
```

## 実際の使用例

### 例1: ファイル読み込み（filesystemMCP経由）

```
User: "config.jsonの内容を確認して"

Claude Desktop:
  1. tools/list で利用可能なツールを取得
     → Search MCPから「filesystem.read_file」等を発見
  2. 「filesystem.read_file」が適切と判断
  3. tools/call で filesystem.read_file を実行
     {
       "name": "filesystem.read_file",
       "arguments": {
         "path": "/path/to/config.json"
       }
     }
  4. Search MCP → filesystem MCP へプロキシ
  5. 結果を解釈してユーザーに提示
```

### 例2: Web検索とデータベースクエリの組み合わせ

```
User: "最新のTypeScript情報を検索して、関連プロジェクトをデータベースから取得"

Claude Desktop:
  1. tools/list で利用可能なツールを取得
     → Search MCPから「brave.search」「database.query」等を発見
  2. まず「brave.search」でWeb検索
     {
       "name": "brave.search",
       "arguments": { "query": "TypeScript latest features" }
     }
     → Search MCP → brave MCP へプロキシ
  3. 次に「database.query」でデータベース検索
     {
       "name": "database.query",
       "arguments": { "sql": "SELECT * FROM projects WHERE..." }
     }
     → Search MCP → database MCP へプロキシ
  4. 両方の結果を統合してユーザーに提示
```

**ポイント**:
- Claude Desktopは Search MCP という1つのMCPサーバーにのみ接続
- 実際には複数のバックエンドMCPサーバー（filesystem、brave、database）を活用
- コンテキスト消費は最小限（軽量なメタデータのみ）

## MCPアグリゲーターの利点

### 1. コンテキスト効率性

**従来のアプローチ（MCPサーバー個別接続）**:
```
filesystem MCP: 50 tools × 200トークン = 10,000トークン
brave MCP:      20 tools × 200トークン = 4,000トークン
database MCP:   30 tools × 200トークン = 6,000トークン
slack MCP:      15 tools × 200トークン = 3,000トークン
─────────────────────────────────────────────────
合計: 23,000トークン消費
```

**Search MCP（アグリゲーター）**:
```
軽量メタデータ: 115 tools × 50トークン = 5,750トークン
詳細取得（3ツール使用時）: 3 × 200トークン = 600トークン
─────────────────────────────────────────────────
合計: 6,350トークン消費 (72%削減)
```

### 2. スケーラビリティ

- MCPサーバー数が増えても、AIクライアントは1つの接続のみ
- 新しいMCPサーバーの追加は設定ファイルに1項目追記するだけ
- 各MCPサーバーは独立して動作し、相互に影響しない

### 3. 保守性

- 各MCPサーバーの設定を一元管理
- Claude Desktop、Cursor、Windsurf等、複数のAIクライアントで同じ設定を再利用
- MCPサーバーの追加・削除・更新が容易

### 4. 透過性

- 既存のMCPサーバーをそのまま利用可能（変更不要）
- 標準MCPプロトコルに準拠
- AIクライアントからは通常のMCPサーバーとして見える

## 将来の拡張

### 1. ツール検索機能の強化

集約されたツールを効率的に検索

```typescript
// 将来の実装例
async handleToolsSearch(query: string): Promise<ToolMetadata[]> {
  // 部分一致検索
  const results = this.toolRegistry.search(query);
  // セマンティック検索（ベクトル検索）
  const semanticResults = await this.vectorSearch(query);
  return [...results, ...semanticResults];
}
```

### 2. ホットリロード

設定ファイル変更時に自動的にMCPサーバーを再起動

```typescript
// 将来の実装例
watchConfig('config/mcp-servers.json', async (changes) => {
  for (const change of changes) {
    if (change.type === 'added') {
      await mcpManager.start(change.serverName);
    } else if (change.type === 'removed') {
      await mcpManager.stop(change.serverName);
    }
  }
});
```

### 3. 統計・監視機能

ツール使用状況やパフォーマンスの追跡

```typescript
// 将来の実装例
class ToolUsageTracker {
  async recordToolCall(serverName: string, toolName: string) {
    // 使用統計を記録
  }

  async getStats(): Promise<UsageStats> {
    // 統計情報を返す
  }
}
```

### 4. Web管理UI（オプション）

MCPサーバーの管理画面とダッシュボード

- MCPサーバーのステータス監視
- ツール使用統計の可視化
- 設定ファイルの編集
- リアルタイムログ表示

## 参考資料

- [Anthropic Model Context Protocol発表](https://www.anthropic.com/news/model-context-protocol)
- [MCP仕様（公式）](https://spec.modelcontextprotocol.io/)
- [Code Execution with MCP - Anthropic Cookbook](https://github.com/anthropics/anthropic-cookbook)

## まとめ

Model Context Protocol (MCP) は、AIエージェントがツールを効率的に活用するための強力なフレームワークです。

**Search MCP Server**は、MCPアグリゲーターとして、以下を実現します：

1. **複数のMCPサーバーを統合** し、AIクライアントの接続先を1つに集約
2. **プログレッシブな開示** により、コンテキスト消費を75%削減
3. **stdio通信とJSON-RPC 2.0** による標準MCPプロトコル準拠
4. **Claude Desktop互換の設定形式** で最小限の学習コスト
5. **透過的なプロキシ** により、既存のMCPサーバーをそのまま活用

この基盤の上に、さらに高度な機能（ツール検索、ホットリロード、統計分析、管理UIなど）を構築していくことができます。
