# MCPサーバー管理ガイド

このガイドでは、Search MCP ServerにMCPサーバーを追加・管理する方法を説明します。

## Search MCPの役割

Search MCP Serverは**MCPアグリゲーター**です。直接ツールを実装するのではなく、既存のMCPサーバーを統合管理します。

### ツールの追加方法

1. **既存のMCPサーバーを追加**（推奨）: 設定ファイルでMCPサーバーを登録
2. **カスタムMCPサーバーを作成**: 独自のMCPサーバーを開発し、Search MCPに追加

## 方法1: 既存のMCPサーバーを追加（推奨）

### 手順

#### 1. 利用可能なMCPサーバーを確認

公式およびコミュニティのMCPサーバー：
- `@modelcontextprotocol/server-filesystem` - ファイルシステム操作
- `@modelcontextprotocol/server-brave-search` - Web検索
- `@modelcontextprotocol/server-postgres` - PostgreSQLデータベース
- `@modelcontextprotocol/server-slack` - Slack連携
- その他、[MCP公式リポジトリ](https://github.com/modelcontextprotocol)を参照

#### 2. 設定ファイルに追加

`config/mcp-servers.json` を編集：

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
        "BRAVE_API_KEY": "your-api-key-here"
      },
      "enabled": true
    },
    "database": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "POSTGRES_CONNECTION_STRING": "postgresql://user:pass@localhost:5432/db"
      },
      "enabled": true
    }
  }
}
```

#### 3. Search MCPを再起動

```bash
npm run build
npm start
```

#### 4. ツールが追加されたことを確認

AIクライアント（Claude Desktop等）から、新しいツール（例: `brave.search`、`database.query`）が利用可能になります。

### 設定項目の説明

| フィールド | 必須 | 説明 | 例 |
|----------|------|------|-----|
| command | ○ | 実行コマンド | `"npx"`, `"node"`, `"/path/to/binary"` |
| args | ○ | コマンド引数の配列 | `["-y", "@modelcontextprotocol/server-filesystem"]` |
| env | - | 環境変数（オブジェクト） | `{"API_KEY": "xxx"}` |
| enabled | - | 有効/無効の切り替え | `true`（デフォルト） |

### Claude Desktopから設定をコピー

既存のClaude Desktop設定（`~/.config/claude/config.json`）から、`mcpServers` セクションをそのままコピー可能です：

```json
// Claude Desktopの設定
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
    }
  }
}
```

↓ そのままSearch MCPの `config/mcp-servers.json` にコピー ↓

```json
// Search MCPの設定
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
    }
  }
}
```

## 方法2: カスタムMCPサーバーを作成（高度）

独自のツールが必要な場合は、カスタムMCPサーバーを作成してSearch MCPに追加できます。

### 概要

1. 標準MCPプロトコルに準拠したサーバーを実装
2. stdio通信でJSON-RPC 2.0メッセージを処理
3. `initialize`、`tools/list`、`tools/call`メソッドを実装
4. Search MCPの設定ファイルに追加

### 最小限のMCPサーバー実装例（Node.js/TypeScript）

```typescript
// custom-mcp-server.ts
import { createInterface } from 'readline';

// ツール定義
const tools = [
  {
    name: 'greet',
    description: '挨拶メッセージを返します',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: '名前'
        }
      },
      required: ['name']
    }
  }
];

// stdio経由でJSON-RPCリクエストを受信
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', async (line) => {
  try {
    const request = JSON.parse(line);
    const response = await handleRequest(request);
    console.log(JSON.stringify(response));
  } catch (error) {
    console.error(JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: 'Parse error'
      }
    }));
  }
});

// リクエストハンドラ
async function handleRequest(request: any) {
  const { id, method, params } = request;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '1.0.0',
          serverInfo: {
            name: 'custom-mcp-server',
            version: '1.0.0'
          },
          capabilities: {
            tools: {}
          }
        }
      };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools
        }
      };

    case 'tools/call':
      const { name, arguments: args } = params;
      if (name === 'greet') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: `Hello, ${args.name}!`
              }
            ]
          }
        };
      }
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32602,
          message: `Tool not found: ${name}`
        }
      };

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`
        }
      };
  }
}
```

### Search MCPへの追加

#### 1. ビルド

```bash
tsc custom-mcp-server.ts
```

#### 2. 設定ファイルに追加

`config/mcp-servers.json`:

```json
{
  "mcpServers": {
    "custom": {
      "command": "node",
      "args": ["/path/to/custom-mcp-server.js"],
      "env": {},
      "enabled": true
    }
  }
}
```

#### 3. Search MCPを再起動

```bash
npm run build
npm start
```

これで、`custom.greet` ツールがAIクライアントから利用可能になります。

## MCPサーバー追加のチェックリスト

### 既存MCPサーバーを追加する場合

- [ ] MCPサーバーのコマンドとパスを確認
- [ ] 必要な環境変数を特定
- [ ] `config/mcp-servers.json` に設定を追加
- [ ] Search MCPを再起動
- [ ] AIクライアントからツールが見えることを確認
- [ ] 実際にツールを実行してテスト

### カスタムMCPサーバーを作成する場合

- [ ] MCPプロトコル（JSON-RPC 2.0 over stdio）に準拠
- [ ] `initialize`、`tools/list`、`tools/call`メソッドを実装
- [ ] エラーハンドリングが適切に実装されている
- [ ] ツールのメタデータが明確
- [ ] パラメータのバリデーション実装
- [ ] `config/mcp-servers.json` に追加
- [ ] Search MCPから正常に呼び出せることを確認

## よくある質問

### Q: Claude Desktopで使っているMCPサーバーをそのまま使える？

A: はい。Claude Desktopの設定（`mcpServers`セクション）をそのまま`config/mcp-servers.json`にコピーできます。

### Q: MCPサーバーの追加後、再起動は必要？

A: はい。現在は設定変更後にSearch MCPの再起動が必要です。将来的にはホットリロード機能を追加予定です。

### Q: 複数のMCPサーバーで同じツール名がある場合は？

A: Search MCPは`serverName.toolName`形式で名前空間を分けるため、衝突しません。例: `filesystem.search`と`brave.search`は別物として扱われます。

### Q: MCPサーバーの追加に失敗した場合は？

A: Search MCPのログを確認してください。MCPサーバーの起動コマンド、パス、環境変数が正しいか確認してください。

### Q: MCPサーバーを一時的に無効化したい

A: `config/mcp-servers.json`で`"enabled": false`を設定してください。

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["..."],
      "enabled": false  // 一時的に無効化
    }
  }
}
```

### Q: カスタムMCPサーバーの開発に役立つリソースは？

A: 以下を参照してください：
- [MCP公式仕様](https://spec.modelcontextprotocol.io/)
- [MCP公式リポジトリ](https://github.com/modelcontextprotocol)
- [JSON-RPC 2.0仕様](https://www.jsonrpc.org/specification)

## 参考リソース

- [MCP公式仕様](https://spec.modelcontextprotocol.io/)
- [MCP公式リポジトリ](https://github.com/modelcontextprotocol)
- [TypeScript公式ドキュメント](https://www.typescriptlang.org/docs/)
- [JSON-RPC 2.0仕様](https://www.jsonrpc.org/specification)
