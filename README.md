# Search MCP Server

**軽量・高速検索を実現するModel Context Protocol (MCP) サーバー**

このプロジェクトは、AnthropicのCode execution with MCPの概念を参考に、AIエージェントが効率的にツールを検索・実行できる軽量なMCPサーバーを提供します。

## 概要

Search MCP Serverは、以下の特徴を持つMCPサーバーの実装です：

- **軽量**: Node.js + Fastifyによる高速・低メモリフットプリント
- **検索性能**: ツールの効率的な発見と実行
- **プログレッシブな開示**: AIはまずツール全体像を把握し、必要な詳細情報だけを動的に読み込む
- **拡張性**: 新しいツールを簡単に追加できるプラグインアーキテクチャ

## 目的

このプロジェクトは、AnthropicのModel Context Protocolの理念に基づき、以下の目標を達成します：

1. **コンテキスト消費の最小化**: AIが必要な情報だけを効率的に取得
2. **安全な実行環境**: 外部環境でのコード実行をサポート
3. **高い検索性能**: ツールを素早く発見できるメタデータ管理
4. **拡張可能性**: 新しいツールを容易に追加できる設計

## クイックスタート

### 必要要件

- Node.js 18以上
- npm または yarn

### インストール

```bash
# リポジトリのクローン
git clone https://github.com/krtw00/search-mcp.git
cd search-mcp

# 依存関係のインストール
npm install

# ビルド
npm run build
```

### 開発モード

```bash
# 開発モードで起動
npm run dev
```

### テスト

```bash
# テストの実行
npm test
```

## 使い方

### サーバーの起動

```bash
npm start
```

サーバーはデフォルトで `http://localhost:3000` で起動します。

### API エンドポイント

#### ヘルスチェック
```bash
curl http://localhost:3000/
```

#### ツール一覧の取得
```bash
curl http://localhost:3000/tools
```

#### ツールの実行
```bash
curl -X POST http://localhost:3000/tools/call \
  -H "Content-Type: application/json" \
  -d '{
    "name": "echo",
    "parameters": {
      "message": "Hello, MCP!"
    }
  }'
```

## プロジェクト構成

```
search-mcp/
├── src/
│   ├── index.ts              # メインサーバーファイル
│   ├── tool-registry.ts      # ツールレジストリの実装
│   ├── types.ts              # 型定義
│   ├── run.ts                # 開発用エントリーポイント
│   └── tools/                # ツールの実装
│       ├── echo.ts           # Echoツール
│       └── search.ts         # Searchツール（プロトタイプ）
├── docs/                     # ドキュメント
├── logs/                     # ログファイル
├── package.json
└── tsconfig.json
```

## 技術スタック

- **ランタイム**: Node.js
- **言語**: TypeScript
- **Webフレームワーク**: Fastify
- **開発ツール**: tsx, ts-node

詳細は [docs/architecture.md](docs/architecture.md) を参照してください。

## ツールの開発

新しいツールを追加する方法については、[docs/tool-development.md](docs/tool-development.md) を参照してください。

## 開発方針

プロジェクトの開発方針とコーディング規約については、[docs/development.md](docs/development.md) を参照してください。

## ドキュメント

- [MCP概念とプロジェクト目標](docs/mcp-concepts.md)
- [アーキテクチャ](docs/architecture.md)
- [API仕様](docs/api.md)
- [ツール開発ガイド](docs/tool-development.md)
- [開発方針とルール](docs/development.md)

## ライセンス

ISC

## 貢献

プルリクエストを歓迎します。大きな変更の場合は、まずissueを開いて変更内容を議論してください。

## 参考

- [Anthropic Model Context Protocol](https://www.anthropic.com/news/model-context-protocol)
- [Fastify Documentation](https://www.fastify.io/)
