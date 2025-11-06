# アーキテクチャ

## 概要

Search MCP Serverは、Model Context Protocol (MCP) の理念に基づいて設計された、軽量で高速な検索可能なツールサーバーです。

## 設計原則

### 1. プログレッシブな開示 (Progressive Disclosure)

AIエージェントは以下の2段階でツールにアクセスします：

1. **ツール一覧の取得** (`GET /tools`): 全ツールのメタデータ（名前、説明、パラメータ）を取得
2. **ツールの実行** (`POST /tools/call`): 必要なツールのみを実行

この設計により、AIは最小限のコンテキストでツールを発見し、必要なときだけ詳細な実行を行えます。

### 2. 軽量アーキテクチャ

```
┌─────────────────────────────────────────┐
│         Fastify Web Server              │
│         (Port 3000)                     │
└─────────────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
   ┌────▼────┐         ┌─────▼─────┐
   │  HTTP   │         │   HTTP    │
   │ Routes  │         │  Routes   │
   │ (GET)   │         │  (POST)   │
   └────┬────┘         └─────┬─────┘
        │                    │
        │              ┌─────▼──────┐
        │              │   Tool     │
        └─────────────►│  Registry  │
                       └─────┬──────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
        ┌─────▼────┐   ┌────▼─────┐  ┌────▼─────┐
        │   Echo   │   │  Search  │  │  Future  │
        │   Tool   │   │   Tool   │  │  Tools   │
        └──────────┘   └──────────┘  └──────────┘
```

## コンポーネント

### 1. Fastify Server (`src/index.ts`)

軽量で高速なWebサーバーフレームワーク。以下のエンドポイントを提供：

- `GET /`: ヘルスチェック
- `GET /tools`: 登録されているツールの一覧を返す
- `POST /tools/call`: 指定されたツールを実行

### 2. Tool Registry (`src/tool-registry.ts`)

ツールの登録・検索・実行を管理する中央レジストリ。

**責務:**
- ツールのメタデータと実装の保存
- ツールの検索
- ツールの実行と結果の返却

**主要メソッド:**
```typescript
register(metadata: ToolMetadata, implementation: ToolImplementation): void
list(): ToolMetadata[]
get(name: string): { metadata, implementation } | undefined
execute(name: string, parameters: Record<string, any>): Promise<any>
```

### 3. Tools (`src/tools/`)

個別のツール実装。各ツールは以下の2つをエクスポート：

- **メタデータ**: ツール名、説明、パラメータ定義
- **実装**: 実際の処理ロジック

**例:**
```typescript
// メタデータ
export const echoMetadata: ToolMetadata = {
  name: 'echo',
  description: '入力されたメッセージをそのまま返します',
  parameters: [...]
};

// 実装
export const echoImplementation: ToolImplementation = async (parameters) => {
  // 処理ロジック
};
```

### 4. Type Definitions (`src/types.ts`)

TypeScriptの型定義で、型安全性を保証：

- `ToolMetadata`: ツールのメタデータ構造
- `ToolParameter`: パラメータ定義
- `ToolCallRequest`: ツール呼び出しリクエスト
- `ToolCallResponse`: ツール呼び出しレスポンス
- `ToolImplementation`: ツール実装関数の型

## データフロー

### ツール一覧取得フロー

```
Client → GET /tools → Tool Registry.list() → ToolMetadata[] → Client
```

### ツール実行フロー

```
Client
  → POST /tools/call {name, parameters}
  → Tool Registry.execute(name, parameters)
  → Tool Implementation
  → Result
  → {success: true, result} OR {success: false, error}
  → Client
```

## 技術スタック

### ランタイム
- **Node.js**: JavaScript実行環境
- **TypeScript**: 型安全な開発

### Webフレームワーク
- **Fastify**:
  - Express比で2倍の性能
  - 低メモリフットプリント
  - JSONスキーマベースのバリデーション
  - 豊富なプラグインエコシステム

### 開発ツール
- **tsx**: TypeScript実行ツール（開発時）
- **ts-node**: TypeScriptのNode.js実行
- **TypeScript Compiler (tsc)**: 本番ビルド

## スケーラビリティ

### 水平スケーリング

複数のサーバーインスタンスを起動することで、リクエストを分散処理できます。

```bash
# 複数ポートで起動
PORT=3000 npm start &
PORT=3001 npm start &
PORT=3002 npm start &
```

ロードバランサー（nginx, HAProxyなど）を前段に配置することで、負荷分散が可能です。

### ツールの追加

新しいツールは、以下の手順で簡単に追加できます：

1. `src/tools/` に新しいツールファイルを作成
2. メタデータと実装をエクスポート
3. `src/index.ts` でツールを登録

詳細は [tool-development.md](tool-development.md) を参照してください。

## セキュリティ考慮事項

### 入力バリデーション

- すべてのツールは、必須パラメータの存在チェックを実施
- 型チェックはTypeScriptの静的型付けで保証

### エラーハンドリング

- すべてのエラーは適切にキャッチされ、クライアントに返される
- スタックトレースは本番環境では露出しない

### 今後の改善項目

- 認証・認可機能の追加
- レート制限の実装
- 入力サニタイゼーション
- パラメータスキーマバリデーション（Fastifyのスキーマ機能を活用）

## パフォーマンス

### 目標

- レスポンスタイム: < 10ms（ツール一覧取得）
- レスポンスタイム: < 100ms（簡単なツール実行）
- メモリフットプリント: < 50MB（アイドル時）

### 最適化戦略

1. **In-Memoryレジストリ**: ツールメタデータをメモリに保持
2. **非同期処理**: すべてのツールは非同期実行
3. **軽量フレームワーク**: Fastifyの高速性を活用

## ロギング

Fastifyの組み込みロガーを使用：

- リクエスト/レスポンスのログ
- エラーログ
- パフォーマンスメトリクス

ログは以下に出力されます：
- `logs/combined.log`: すべてのログ
- `logs/error.log`: エラーログのみ
- `logs/interactions.log`: ツール実行ログ

## 将来の拡張

### 検索機能の強化

- ツール名での部分一致検索
- タグベースのフィルタリング
- セマンティック検索（ベクトル検索）

### 外部実行環境との連携

- サンドボックス環境でのツール実行
- コンテナ（Docker）でのツール実行
- リモート実行環境との連携

### メトリクスと監視

- Prometheusメトリクスのエクスポート
- ヘルスチェックエンドポイントの強化
- 分散トレーシング（OpenTelemetry）
