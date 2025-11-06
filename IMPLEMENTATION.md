# Search MCP 実装ガイド

## 🚀 新しい実装（BunベースのMCPアグリゲーター）

この実装は、最適なパフォーマンスと開発体験のために **Bun** をプライマリランタイムとして使用しています。

### アーキテクチャ

```
┌─────────────────────────────────────────────┐
│   AIクライアント (Claude/Cursor/Windsurf)   │
└──────────────────┬──────────────────────────┘
                   │ stdio (JSON-RPC 2.0)
                   ↓
┌─────────────────────────────────────────────┐
│       Search MCP Server (アグリゲーター)    │
│  ┌──────────────────────────────────────┐  │
│  │  MCP Client Manager                  │  │
│  │  - 複数のMCPサーバーを集約           │  │
│  │  - コンテキストを75%削減             │  │
│  └──────────────────────────────────────┘  │
└──────┬────────┬────────┬────────┬──────────┘
       │ stdio  │ stdio  │ stdio  │ stdio
       ↓        ↓        ↓        ↓
┌──────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│filesystem│ │ brave  │ │database│ │ slack  │
│   MCP    │ │  MCP   │ │  MCP   │ │  MCP   │
└──────────┘ └────────┘ └────────┘ └────────┘
```

### 主要コンポーネント

1. **MCP Client** (`src/mcp/mcp-client.ts`)
   - 単一のバックエンドMCPサーバーとの通信を管理
   - stdio通信とJSON-RPC 2.0プロトコルを処理
   - 子プロセスの起動と管理

2. **MCP Client Manager** (`src/mcp/mcp-client-manager.ts`)
   - 複数のMCPクライアントを管理
   - すべてのバックエンドサーバーからツールを集約
   - 軽量なツールメタデータを提供（コンテキスト削減）

3. **Search MCP Server** (`src/index.ts`)
   - メインエントリーポイント
   - stdio経由でAIクライアントと通信
   - 適切なバックエンドサーバーへツール呼び出しをプロキシ

## 📋 前提条件

### オプション1: Bun（推奨）

```bash
# Bunのインストール
curl -fsSL https://bun.sh/install | bash

# インストール確認
bun --version
```

### オプション2: Node.js（フォールバック）

```bash
# Node.js 18以上が必要
node --version
```

## 🔧 セットアップ

### 1. 依存関係のインストール

```bash
# Bunを使用（推奨）
bun install

# Node.jsを使用
npm install
```

### 2. MCPサーバーの設定

サンプル設定をコピー：

```bash
cp config/mcp-servers.example.json config/mcp-servers.json
```

`config/mcp-servers.json` を編集：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/directory"],
      "env": {},
      "enabled": true
    },
    "brave": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "your-api-key-here"
      },
      "enabled": false
    }
  }
}
```

## 🏃 実行方法

### 開発モード

```bash
# Bunで実行（推奨）
bun run dev

# Node.jsで実行
npm run dev:node
```

### 本番ビルド

```bash
# Bunでビルド
bun run build

# シングルバイナリをビルド
bun run build:binary

# Node.jsでビルド
npm run build:node
```

### バイナリの実行

```bash
# バイナリビルド後
./search-mcp
```

## 🧪 テスト

### stdioを使った手動テスト

テストスクリプト `test-stdin.js` を作成：

```javascript
import { spawn } from 'child_process';

const server = spawn('bun', ['run', 'src/index.ts']);

// initialize リクエストを送信
server.stdin.write(JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '1.0.0',
    clientInfo: { name: 'test-client', version: '1.0.0' }
  }
}) + '\n');

// レスポンスを待機
server.stdout.on('data', (data) => {
  console.log('レスポンス:', data.toString());
});

// 2秒後にツール一覧を取得
setTimeout(() => {
  server.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {}
  }) + '\n');
}, 2000);
```

実行：

```bash
node test-stdin.js
```

## 🔌 AIクライアントとの統合

### Claude Desktop

`~/.config/claude/config.json` を編集：

```json
{
  "mcpServers": {
    "search-mcp": {
      "command": "bun",
      "args": ["run", "/path/to/search-mcp/src/index.ts"],
      "env": {
        "MCP_CONFIG_PATH": "/path/to/search-mcp/config/mcp-servers.json"
      }
    }
  }
}
```

またはバイナリを使用：

```json
{
  "mcpServers": {
    "search-mcp": {
      "command": "/path/to/search-mcp/search-mcp",
      "args": [],
      "env": {
        "MCP_CONFIG_PATH": "/path/to/search-mcp/config/mcp-servers.json"
      }
    }
  }
}
```

### Cursor / Windsurf

それぞれの設定ファイルで同様の設定を行います。

## 📊 コンテキスト削減

### 変更前（直接MCP接続）

```
filesystem MCP: 50 tools × 200トークン = 10,000トークン
brave MCP:      20 tools × 200トークン = 4,000トークン
database MCP:   30 tools × 200トークン = 6,000トークン
slack MCP:      15 tools × 200トークン = 3,000トークン
─────────────────────────────────────────────
合計: 23,000トークン
```

### 変更後（Search MCPアグリゲーター）

```
軽量メタデータ: 115 tools × 50トークン = 5,750トークン
ツール実行（3ツール使用時）: 3 × 200トークン = 600トークン
─────────────────────────────────────────────
合計: 6,350トークン（72%削減）
```

## 🐛 トラブルシューティング

### MCPサーバーの起動に失敗する

```bash
# コマンドが利用可能か確認
npx -y @modelcontextprotocol/server-filesystem --version

# ログを確認
# stderrがconsole.errorに表示されます
```

### Bunが見つからない

```bash
# Bunをインストール
curl -fsSL https://bun.sh/install | bash

# PATHに追加
export PATH="$HOME/.bun/bin:$PATH"

# またはNode.jsフォールバックを使用
npm run dev:node
```

### 設定ファイルが見つからない

```bash
# カスタム設定パスを指定
export MCP_CONFIG_PATH=/path/to/config/mcp-servers.json
bun run dev
```

## 📚 追加リソース

- [MCPプロトコル仕様](https://spec.modelcontextprotocol.io/)
- [Bunドキュメント](https://bun.sh/docs)
- [設計ドキュメント](./docs/design/)

## 🎯 次のステップ

1. ✅ 基本的なMCPアグリゲーター実装
2. 🚧 ツール検索機能の追加
3. 🚧 設定変更時のホットリロード実装
4. 🚧 監視と統計機能の追加
5. 🚧 管理UI構築（オプション）

## 🤝 貢献

アーキテクチャの詳細については、`docs/design/` の設計ドキュメントを参照してください。
