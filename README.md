# Search MCP Server

**複数のMCPサーバーを統合し、AIクライアントのコンテキスト消費を削減するMCPアグリゲーター**

Search MCP Serverは、Model Context Protocol (MCP) の理念に基づき、複数のMCPサーバーを1つに集約することで、Claude Desktop、Cursor、Windsurf等のAIクライアントのコンテキスト消費を**70-80%削減**します。

## 問題と解決策

### 現在の課題

```
Claude Desktop
├── filesystem MCP (50 tools)
├── brave-search MCP (20 tools)
├── database MCP (30 tools)
└── slack MCP (15 tools)

→ 115 tools × 平均200トークン = 23,000トークン消費 😢
```

各MCPサーバーが個別に接続されており、すべてのツールのメタデータが初期読み込み時にコンテキストを消費します。

### Search MCPの解決策

```
Claude Desktop
└── Search MCP (アグリゲーター)
    ├── filesystem MCP
    ├── brave-search MCP
    ├── database MCP
    └── slack MCP

→ 軽量メタデータのみ: 約5,750トークン (75%削減!) 🎉
```

Search MCPが複数のMCPサーバーを束ね、**プログレッシブな開示**により必要な情報だけを段階的に提供します。

## 主な特徴

- 🎯 **MCPアグリゲーター**: 複数のMCPサーバーを1つに統合
- 📉 **コンテキスト削減**: 初期読み込みを70-80%削減
- 🔌 **簡単な移行**: 既存のClaude Desktop設定をコピペするだけ
- 🔄 **プログレッシブ開示**: 必要な情報のみを段階的に取得
- 🛠️ **MCP標準準拠**: stdio通信等の標準プロトコルをサポート
- ⚡ **軽量**: Node.js + TypeScript による高速実装

## クイックスタート

### 1. インストール

```bash
# リポジトリのクローン
git clone https://github.com/krtw00/search-mcp.git
cd search-mcp

# 依存関係のインストール
npm install

# ビルド
npm run build
```

### 2. 設定ファイルの作成

既存のClaude Desktop設定から`mcpServers`セクションをコピー：

```bash
mkdir -p config
vi config/mcp-servers.json
```

**config/mcp-servers.json**:
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/you/projects"]
    },
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "${BRAVE_API_KEY}"
      }
    }
  }
}
```

**ポイント**: Claude Desktopの設定ファイルと**全く同じ形式**なので、コピペするだけ！

### 3. Search MCPの起動

```bash
npm start
```

### 4. Claude Desktopの設定を更新

**変更前** (`~/.config/claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "filesystem": { ... },
    "brave-search": { ... },
    "database": { ... }
  }
}
```

**変更後**:
```json
{
  "mcpServers": {
    "search-mcp": {
      "command": "node",
      "args": ["/path/to/search-mcp/dist/index.js"]
    }
  }
}
```

### 5. Claude Desktopを再起動

完了！これでSearch MCP経由ですべてのツールが使えるようになり、コンテキスト消費が大幅に削減されます。

## コンテキスト削減の仕組み

### 段階的な情報取得

1. **初期読み込み（軽量）**
   - ツール名とサーバー名のみ返す
   - 115 tools × 50トークン = 5,750トークン

2. **詳細取得（必要時のみ）**
   - 詳細なパラメータ情報を返す
   - 1 tool × 200トークン = 200トークン

3. **実行**
   - ツールを実行し、結果を返す

**合計**: 約6,000トークン (従来の23,000トークンから75%削減)

## プロジェクト構成

```
search-mcp/
├── src/
│   ├── mcp/
│   │   ├── mcp-client-manager.ts  # MCP統合管理
│   │   └── mcp-client.ts          # 個別MCP接続
│   ├── index.ts                   # MCPサーバー実装
│   ├── tool-registry.ts           # ツール集約
│   └── types.ts                   # 型定義
├── config/
│   └── mcp-servers.json           # MCP設定ファイル
├── docs/
│   ├── design/                    # 詳細設計
│   │   ├── 07-simplified-setup.md
│   │   └── 08-mcp-aggregator.md
│   ├── architecture.md
│   └── mcp-concepts.md
└── package.json
```

## MCPプロトコル対応

Search MCPは、Model Context Protocolの標準仕様に準拠しています：

- ✅ **stdio通信**: 標準入出力を使用した通信
- ✅ **ツール発見**: `tools/list` メソッド
- ✅ **ツール実行**: `tools/call` メソッド
- ✅ **初期化**: `initialize` プロトコル
- 🔜 **SSE (Server-Sent Events)**: 今後対応予定
- 🔜 **リソース管理**: 今後対応予定

## 対応MCPサーバー

以下を含む、すべての標準MCP準拠サーバーに対応：

- [@modelcontextprotocol/server-filesystem](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem)
- [@modelcontextprotocol/server-brave-search](https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search)
- [@modelcontextprotocol/server-postgres](https://github.com/modelcontextprotocol/servers/tree/main/src/postgres)
- [@modelcontextprotocol/server-github](https://github.com/modelcontextprotocol/servers/tree/main/src/github)
- [@modelcontextprotocol/server-slack](https://github.com/modelcontextprotocol/servers/tree/main/src/slack)
- その他、MCPプロトコルを実装したすべてのサーバー

## ドキュメント

### ユーザー向け
- [セットアップガイド](docs/design/07-simplified-setup.md) - 詳細なセットアップ手順
- [MCP概念](docs/mcp-concepts.md) - MCPの基本概念

### 開発者向け
- [MCPアグリゲーター設計](docs/design/08-mcp-aggregator.md) - 内部設計の詳細
- [アーキテクチャ](docs/architecture.md) - システムアーキテクチャ
- [設計ドキュメント](docs/design/) - 詳細な実装設計

## ロードマップ

- [x] Phase 1: MCPアグリゲーター基本実装
- [ ] Phase 2: 検索機能強化
- [ ] Phase 3: セキュリティ機能（認証・レート制限）
- [ ] Phase 4: 動的MCPサーバー登録
- [ ] Phase 5: Web管理UI（オプション）

詳細は [docs/design/00-overview.md](docs/design/00-overview.md) を参照。

## 技術スタック

- **ランタイム**: Node.js 18+
- **言語**: TypeScript 5.9+
- **プロトコル**: MCP (Model Context Protocol)
- **通信**: stdio, HTTP (内部実装)

## 開発

### 開発モード

```bash
npm run dev
```

### テスト

```bash
npm test
```

### ビルド

```bash
npm run build
```

## トラブルシューティング

### MCPサーバーに接続できない

```bash
# 詳細ログを有効化
LOG_LEVEL=debug npm start

# 設定を確認
cat config/mcp-servers.json
```

### 環境変数が読み込まれない

```bash
# 環境変数を設定
export BRAVE_API_KEY="your-api-key"

# または.envファイルを使用
echo "BRAVE_API_KEY=your-api-key" > .env
```

## ライセンス

ISC

## 貢献

プルリクエストを歓迎します。大きな変更の場合は、まずissueを開いて変更内容を議論してください。

## 参考

- [Anthropic Model Context Protocol](https://www.anthropic.com/news/model-context-protocol)
- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [MCP Servers Repository](https://github.com/modelcontextprotocol/servers)
