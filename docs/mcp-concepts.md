# Model Context Protocol (MCP) の概念

## 概要

Model Context Protocol (MCP) は、Anthropicが提唱する、AIエージェントがツールや外部リソースと効率的に連携するためのプロトコルです。

このドキュメントでは、MCPの基本概念と、Search MCP Serverでの実装方針について説明します。

## 背景と課題

### AIエージェントが直面する課題

1. **コンテキストウィンドウの制限**
   - AIモデルには処理できるトークン数に上限がある
   - すべてのツール情報を一度に渡すとコンテキストを圧迫

2. **ツールの発見性**
   - 多数のツールから適切なものを素早く見つける必要がある
   - ツールのメタデータが不明瞭だと選択が困難

3. **実行環境の安全性**
   - AIが生成したコードを安全に実行する環境が必要
   - サンドボックス化や外部実行環境の活用が重要

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

## Anthropicの Code Execution with MCP

### 基本アーキテクチャ

```
┌─────────────────────┐
│   Claude (AI)       │
│                     │
│  1. ツール発見      │
│  2. 適切なツール選択│
│  3. コード生成      │
└──────────┬──────────┘
           │
           │ MCP
           ▼
┌─────────────────────┐
│  MCP Server         │
│                     │
│  - ツールレジストリ │
│  - メタデータ管理   │
│  - ルーティング     │
└──────────┬──────────┘
           │
           │
    ┌──────┴──────────────┐
    │                     │
    ▼                     ▼
┌─────────┐         ┌──────────┐
│ Tool 1  │         │  Tool 2  │
│ (実行)  │         │  (実行)  │
└─────────┘         └──────────┘
```

### 実行フロー

1. **ツール発見フェーズ**
   ```
   Claude: "利用可能なツールは何ですか？"
   MCP Server: [ツール一覧のメタデータ]
   ```

2. **ツール選択フェーズ**
   ```
   Claude: (内部で)どのツールが適切か判断
   ```

3. **実行フェーズ**
   ```
   Claude: "searchツールを実行してください（パラメータ: ...）"
   MCP Server: ツールを実行し、結果を返す
   ```

4. **結果利用フェーズ**
   ```
   Claude: 結果を解釈し、ユーザーに応答
   ```

## Search MCP Serverでの実装

### 設計目標

1. **軽量性**
   - 最小限の依存関係
   - 高速な起動時間
   - 低メモリフットプリント

2. **高い検索性能**
   - 効率的なツール検索
   - 明確なメタデータ
   - 将来的なセマンティック検索の導入

3. **拡張性**
   - 新しいツールの簡単な追加
   - プラグインアーキテクチャ

### アーキテクチャマッピング

| MCP概念 | Search MCP Server実装 |
|---------|----------------------|
| ツール発見 | `GET /tools` エンドポイント |
| ツール実行 | `POST /tools/call` エンドポイント |
| メタデータ管理 | `ToolRegistry` クラス |
| ツール定義 | `src/tools/` ディレクトリ |

### プログレッシブな開示の実装

**Phase 1: ツール一覧の取得**
```typescript
// 軽量なメタデータのみを返す
server.get('/tools', async (request, reply) => {
  return {
    tools: toolRegistry.list() // メタデータのみ
  };
});
```

**Phase 2: ツールの実行**
```typescript
// 選択されたツールのみを実行
server.post('/tools/call', async (request, reply) => {
  const { name, parameters } = request.body;
  const result = await toolRegistry.execute(name, parameters);
  return { success: true, result };
});
```

## 実際の使用例

### 例1: データ検索タスク

```
User: "最近の売上データを検索して"

Claude:
  1. GET /tools でツール一覧を取得
  2. "search" ツールが適切と判断
  3. POST /tools/call で search を実行
     {
       "name": "search",
       "parameters": {
         "query": "最近の売上",
         "limit": 10
       }
     }
  4. 結果を解釈してユーザーに提示
```

### 例2: 複雑な計算タスク

```
User: "過去3ヶ月の平均売上を計算して"

Claude:
  1. GET /tools でツール一覧を取得
  2. "search" と "calculate" が必要と判断
  3. まず search で売上データを取得
  4. 次に calculate で平均を計算
  5. 結果をユーザーに提示
```

## MCPの利点

### 1. コンテキスト効率性

**従来のアプローチ**:
```
すべてのツール定義 (10,000トークン)
+ ユーザーのクエリ (100トークン)
+ AIの応答 (500トークン)
= 10,600トークン消費
```

**MCPアプローチ**:
```
ツールメタデータ (1,000トークン)
+ ユーザーのクエリ (100トークン)
+ AIの応答 (500トークン)
= 1,600トークン消費 (84%削減)
```

### 2. スケーラビリティ

- ツール数が増えてもメタデータは線形に増加
- 実行は必要なツールのみなので、O(1)の複雑度

### 3. 保守性

- ツールの追加・変更が独立して可能
- 既存のツールに影響を与えない

### 4. 安全性

- ツールの実行を制御可能
- サンドボックス環境での実行が容易

## 将来の拡張

### 1. セマンティック検索

ツールの説明をベクトル化し、意味的に類似したツールを検索

```typescript
// 将来の実装例
server.post('/tools/semantic-search', async (request, reply) => {
  const { query } = request.body;
  const embeddings = await generateEmbeddings(query);
  const results = await vectorSearch(embeddings);
  return { tools: results };
});
```

### 2. ツールの合成

複数のツールを組み合わせて新しい機能を作成

```typescript
// 将来の実装例
server.post('/tools/compose', async (request, reply) => {
  const { tools, workflow } = request.body;
  const result = await executeWorkflow(tools, workflow);
  return { result };
});
```

### 3. 外部実行環境

Dockerコンテナでツールを実行

```typescript
// 将来の実装例
server.post('/tools/execute-in-container', async (request, reply) => {
  const { name, parameters } = request.body;
  const result = await dockerExecutor.run(name, parameters);
  return { result };
});
```

## 参考資料

- [Anthropic Model Context Protocol発表](https://www.anthropic.com/news/model-context-protocol)
- [MCP仕様（公式）](https://spec.modelcontextprotocol.io/)
- [Code Execution with MCP - Anthropic Cookbook](https://github.com/anthropics/anthropic-cookbook)

## まとめ

Model Context Protocol (MCP) は、AIエージェントがツールを効率的に活用するための強力なフレームワークです。

Search MCP Serverは、MCPの原則に基づき、以下を実現します：

1. **プログレッシブな開示** でコンテキストを節約
2. **構造化されたメタデータ** で高い検索性能
3. **拡張可能なアーキテクチャ** で将来の機能追加に対応

この基盤の上に、さらに高度な機能（セマンティック検索、ツール合成、外部実行環境など）を構築していくことができます。
