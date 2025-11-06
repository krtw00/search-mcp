# MCP プロトコル仕様

## 概要

Search MCP Serverは、**Model Context Protocol (MCP)** に準拠したサーバーです。MCPは、stdio通信を用いたJSON-RPC 2.0ベースのプロトコルです。

### 通信方式

- **通信路**: 標準入出力 (stdin/stdout)
- **プロトコル**: JSON-RPC 2.0
- **データ形式**: JSON (1行1メッセージ)

### AIクライアントとの接続

AIクライアント（Claude Desktop、Cursor、Windsurf等）は、Search MCP Serverを子プロセスとして起動し、stdio経由で通信します。

```json
// Claude Desktopの設定例 (~/.config/claude/config.json)
{
  "mcpServers": {
    "search-mcp": {
      "command": "node",
      "args": ["/path/to/search-mcp/dist/index.js"]
    }
  }
}
```

---

## MCPメソッド

### 1. initialize

MCP接続を初期化します。AIクライアントが最初に呼び出すメソッドです。

**リクエスト**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "1.0.0",
    "clientInfo": {
      "name": "claude-desktop",
      "version": "1.0.0"
    }
  }
}
```

**レスポンス**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "1.0.0",
    "serverInfo": {
      "name": "search-mcp",
      "version": "1.0.0"
    },
    "capabilities": {
      "tools": {}
    }
  }
}
```

**パラメータ**

| フィールド | 型 | 必須 | 説明 |
|----------|---|------|------|
| protocolVersion | string | ○ | MCPプロトコルバージョン |
| clientInfo | object | ○ | クライアント情報 |

---

### 2. tools/list

集約された全ツールの一覧を取得します（軽量版メタデータ）。

**リクエスト**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

**レスポンス**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "filesystem.read_file",
        "description": "ファイルの内容を読み込みます"
      },
      {
        "name": "filesystem.write_file",
        "description": "ファイルに内容を書き込みます"
      },
      {
        "name": "brave.search",
        "description": "Web検索を実行します"
      },
      {
        "name": "database.query",
        "description": "データベースクエリを実行します"
      }
    ]
  }
}
```

**レスポンスフィールド**

| フィールド | 型 | 説明 |
|----------|---|------|
| tools | Tool[] | ツールメタデータの配列（軽量版） |

**Tool（軽量版）**

| フィールド | 型 | 説明 |
|----------|---|------|
| name | string | ツール名（`serverName.toolName`形式） |
| description | string | ツールの簡潔な説明 |

**注意**: パラメータの詳細（inputSchema）は含まれません。これにより、コンテキスト消費を大幅に削減します。

---

### 3. tools/call

指定したツールを実行します。Search MCPは、対応するバックエンドMCPサーバーへリクエストをプロキシします。

**リクエスト**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "filesystem.read_file",
    "arguments": {
      "path": "/path/to/config.json"
    }
  }
}
```

**成功レスポンス**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\n  \"key\": \"value\"\n}"
      }
    ]
  }
}
```

**別の例: Web検索**

**リクエスト**
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "brave.search",
    "arguments": {
      "query": "TypeScript best practices"
    }
  }
}
```

**成功レスポンス**
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "検索結果:\n1. TypeScript公式ドキュメント...\n2. ..."
      }
    ]
  }
}
```

**エラーレスポンス**

存在しないツールを指定した場合:
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "error": {
    "code": -32602,
    "message": "Tool not found: invalid.tool"
  }
}
```

バックエンドMCPサーバーがエラーを返した場合:
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "error": {
    "code": -32000,
    "message": "Backend MCP server error: File not found"
  }
}
```

**パラメータ**

| フィールド | 型 | 必須 | 説明 |
|----------|---|------|------|
| name | string | ○ | 実行するツール名（`serverName.toolName`形式） |
| arguments | object | ○ | ツールに渡す引数（空オブジェクト可） |

**レスポンスフィールド**

| フィールド | 型 | 説明 |
|----------|---|------|
| result | object | ツールの実行結果（成功時） |
| error | object | エラー情報（失敗時） |

---

## エラーハンドリング

### JSON-RPC 2.0エラーレスポンス

すべてのエラーレスポンスは、JSON-RPC 2.0の標準形式で返されます：

```json
{
  "jsonrpc": "2.0",
  "id": <request_id>,
  "error": {
    "code": <error_code>,
    "message": "<error_message>",
    "data": <optional_error_details>
  }
}
```

### 標準エラーコード

| コード | 説明 | 例 |
|-------|------|-----|
| -32700 | Parse error | 不正なJSON |
| -32600 | Invalid Request | JSON-RPC形式エラー |
| -32601 | Method not found | 存在しないメソッド |
| -32602 | Invalid params | パラメータエラー（ツール名が存在しない等） |
| -32603 | Internal error | サーバー内部エラー |
| -32000 | Server error | バックエンドMCPサーバーエラー |

### 一般的なエラー例

**ツールが存在しない**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "error": {
    "code": -32602,
    "message": "Tool not found: invalid.tool"
  }
}
```

**バックエンドMCPサーバーが起動していない**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "error": {
    "code": -32000,
    "message": "MCP server 'filesystem' is not running"
  }
}
```

**必須パラメータの不足**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "error": {
    "code": -32000,
    "message": "Backend error: Required parameter 'path' is missing"
  }
}
```

---

## 使用例

### AIクライアントからの呼び出し

Search MCP Serverは、AIクライアント（Claude Desktop、Cursor、Windsurf）から自動的に呼び出されます。

#### Claude Desktopの設定

`~/.config/claude/config.json` (macOS/Linux) または `%APPDATA%\Claude\config.json` (Windows):

```json
{
  "mcpServers": {
    "search-mcp": {
      "command": "node",
      "args": ["/path/to/search-mcp/dist/index.js"],
      "env": {}
    }
  }
}
```

Claude Desktopを再起動すると、Search MCPが自動的に起動し、stdio経由で通信します。

### stdio通信のテスト（開発者向け）

**Node.jsでの実装例**

```javascript
import { spawn } from 'child_process';

// Search MCP Serverを起動
const server = spawn('node', ['/path/to/search-mcp/dist/index.js']);

// JSON-RPCリクエストを送信
function sendRequest(method, params, id = 1) {
  const request = JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    params
  });
  server.stdin.write(request + '\n');
}

// レスポンスを受信
server.stdout.on('data', (data) => {
  const response = JSON.parse(data.toString());
  console.log('Response:', response);
});

// 初期化
sendRequest('initialize', {
  protocolVersion: '1.0.0',
  clientInfo: { name: 'test-client', version: '1.0.0' }
}, 1);

// ツール一覧取得
sendRequest('tools/list', {}, 2);

// ツール実行
sendRequest('tools/call', {
  name: 'filesystem.read_file',
  arguments: { path: '/path/to/file.txt' }
}, 3);
```

---

## プロトコルバージョン

現在のMCPプロトコルバージョン: `1.0.0`

Search MCPは、標準のMCPプロトコル仕様に準拠しています。詳細は [MCP公式仕様](https://spec.modelcontextprotocol.io/) を参照してください。

---

## バックエンドMCPサーバーの管理

Search MCPは、`config/mcp-servers.json` で定義されたバックエンドMCPサーバーを管理します。

### 設定例

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/user/Documents"],
      "env": {},
      "enabled": true
    },
    "brave": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "your-api-key"
      },
      "enabled": true
    }
  }
}
```

各MCPサーバーは、Search MCPの起動時に自動的に開始され、stdio経由で通信します。
