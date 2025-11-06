# API仕様

## ベースURL

```
http://localhost:3000
```

## エンドポイント

### 1. ヘルスチェック

サーバーが正常に動作しているかを確認します。

**エンドポイント**
```
GET /
```

**リクエスト**
```bash
curl http://localhost:3000/
```

**レスポンス**
```json
{
  "status": "ok",
  "message": "MCP Server is running"
}
```

**ステータスコード**
- `200 OK`: サーバーが正常に動作中

---

### 2. ツール一覧取得

登録されている全ツールのメタデータを取得します。

**エンドポイント**
```
GET /tools
```

**リクエスト**
```bash
curl http://localhost:3000/tools
```

**レスポンス**
```json
{
  "tools": [
    {
      "name": "echo",
      "description": "入力されたメッセージをそのまま返します",
      "parameters": [
        {
          "name": "message",
          "type": "string",
          "description": "返すメッセージ",
          "required": true
        }
      ]
    },
    {
      "name": "search",
      "description": "テキストを検索します（プロトタイプ版）",
      "parameters": [
        {
          "name": "query",
          "type": "string",
          "description": "検索クエリ",
          "required": true
        },
        {
          "name": "limit",
          "type": "number",
          "description": "返す結果の最大数",
          "required": false
        }
      ]
    }
  ]
}
```

**ステータスコード**
- `200 OK`: 成功

**レスポンスフィールド**

| フィールド | 型 | 説明 |
|----------|---|------|
| tools | ToolMetadata[] | ツールメタデータの配列 |

**ToolMetadata**

| フィールド | 型 | 説明 |
|----------|---|------|
| name | string | ツール名（一意） |
| description | string | ツールの説明 |
| parameters | ToolParameter[] | パラメータ定義の配列 |

**ToolParameter**

| フィールド | 型 | 説明 |
|----------|---|------|
| name | string | パラメータ名 |
| type | string | パラメータの型（string, number, boolean, objectなど） |
| description | string | パラメータの説明 |
| required | boolean | 必須かどうか（省略可） |

---

### 3. ツール実行

指定したツールを実行します。

**エンドポイント**
```
POST /tools/call
```

**リクエストボディ**

| フィールド | 型 | 必須 | 説明 |
|----------|---|------|------|
| name | string | ○ | 実行するツール名 |
| parameters | object | ○ | ツールに渡すパラメータ（空オブジェクト可） |

**例: Echoツールの実行**

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

**成功レスポンス**
```json
{
  "success": true,
  "result": {
    "echo": "Hello, MCP!",
    "timestamp": "2025-01-15T10:30:00.000Z"
  }
}
```

**例: Searchツールの実行**

```bash
curl -X POST http://localhost:3000/tools/call \
  -H "Content-Type: application/json" \
  -d '{
    "name": "search",
    "parameters": {
      "query": "test query",
      "limit": 5
    }
  }'
```

**成功レスポンス**
```json
{
  "success": true,
  "result": {
    "query": "test query",
    "results": [
      {
        "id": 1,
        "title": "Result for \"test query\" - 1",
        "score": 0.95
      },
      {
        "id": 2,
        "title": "Result for \"test query\" - 2",
        "score": 0.87
      },
      {
        "id": 3,
        "title": "Result for \"test query\" - 3",
        "score": 0.75
      }
    ],
    "count": 3
  }
}
```

**エラーレスポンス**

存在しないツールを指定した場合:
```json
{
  "success": false,
  "error": "Tool not found: invalid_tool"
}
```

必須パラメータが不足している場合:
```json
{
  "success": false,
  "error": "message parameter is required"
}
```

**ステータスコード**
- `200 OK`: 成功
- `400 Bad Request`: リクエストエラー（ツールが存在しない、パラメータ不正など）

**レスポンスフィールド**

| フィールド | 型 | 説明 |
|----------|---|------|
| success | boolean | 実行が成功したかどうか |
| result | any | ツールの実行結果（成功時のみ） |
| error | string | エラーメッセージ（失敗時のみ） |

---

## エラーハンドリング

### エラーレスポンスの形式

すべてのエラーレスポンスは以下の形式で返されます：

```json
{
  "success": false,
  "error": "エラーメッセージ"
}
```

### 一般的なエラー

| エラーメッセージ | 原因 | 解決方法 |
|---------------|------|---------|
| Tool name is required | リクエストボディに `name` がない | `name` フィールドを追加 |
| Tool not found: {name} | 指定したツールが存在しない | `/tools` で利用可能なツールを確認 |
| {parameter} parameter is required | 必須パラメータが不足 | ツールのメタデータを確認し、必須パラメータを追加 |

---

## 使用例

### Node.jsから呼び出す

```javascript
// ツール一覧を取得
const response = await fetch('http://localhost:3000/tools');
const { tools } = await response.json();
console.log(tools);

// Echoツールを実行
const callResponse = await fetch('http://localhost:3000/tools/call', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: 'echo',
    parameters: {
      message: 'Hello from Node.js!'
    }
  })
});
const result = await callResponse.json();
console.log(result);
```

### Pythonから呼び出す

```python
import requests

# ツール一覧を取得
response = requests.get('http://localhost:3000/tools')
tools = response.json()['tools']
print(tools)

# Echoツールを実行
response = requests.post(
    'http://localhost:3000/tools/call',
    json={
        'name': 'echo',
        'parameters': {
            'message': 'Hello from Python!'
        }
    }
)
result = response.json()
print(result)
```

---

## レート制限

現在、レート制限は実装されていません。将来のバージョンで追加予定です。

---

## バージョニング

現在のAPIバージョン: `v1.0.0`

今後、破壊的変更が必要な場合は、URLパスにバージョン番号を含める予定です（例: `/v2/tools`）。
