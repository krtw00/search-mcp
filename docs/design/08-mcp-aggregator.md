# MCPアグリゲーター設計

## 概要

Search MCP Serverを**MCPアグリゲーター**として機能させ、複数のMCPサーバーを束ねてコンテキスト消費を削減します。

## 問題の定義

### 現在の課題

```
┌─────────────────┐
│  Claude CLI     │
├─────────────────┤
│ 接続先:         │
│  - filesystem   │ → 50個のツール
│  - brave-search │ → 20個のツール
│  - database     │ → 30個のツール
│  - slack        │ → 15個のツール
└─────────────────┘
   ↓
全ツールのメタデータを読み込み
= 115個のツール × 平均200トークン = 23,000トークン消費
```

**問題点**:
- コンテキストウィンドウを大量に消費
- 実際に使うツールは一部なのに全ツール情報を保持
- MCPサーバーが増えるたびに消費が増加

### 解決策: Search MCP Aggregator

```
┌─────────────────┐
│  Claude CLI     │
├─────────────────┤
│ 接続先:         │
│  - search-mcp   │ → 軽量なメタデータのみ
└─────────────────┘
        ↓
   Search MCP (アグリゲーター)
        ↓
   ┌────┴────┬──────────┬──────────┐
   ↓         ↓          ↓          ↓
filesystem  brave  database   slack
(50 tools) (20)   (30)        (15)

初期読み込み: メタデータのみ (5,000トークン)
必要時のみ: 個別ツール詳細を取得
```

**効果**:
- 初期コンテキスト消費を 80% 削減
- プログレッシブな開示を実現
- MCPサーバーの追加が容易

## ユーザーシナリオ

### ペルソナ: 田中エンジニア

**現在の設定**:
```json
// ~/.config/claude/claude_desktop_config.json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/tanaka/projects"]
    },
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": { "BRAVE_API_KEY": "..." }
    },
    "database": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": { "DATABASE_URL": "..." }
    },
    "slack": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-slack"],
      "env": { "SLACK_TOKEN": "..." }
    }
  }
}
```

**やりたいこと**:
1. Search MCPに既存のMCP設定をコピペ
2. Claude CLIの接続先をSearch MCPのみに変更
3. コンテキスト消費を削減しながら全機能を使用

## 設計

### 1. MCP Server Registry

#### 1.1 設定ファイル形式

**場所**: `~/.search-mcp/servers.json` または `./config/mcp-servers.json`

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/tanaka/projects"],
      "enabled": true,
      "metadata": {
        "description": "File system operations",
        "category": "filesystem",
        "tags": ["files", "local"]
      }
    },
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "${BRAVE_API_KEY}"
      },
      "enabled": true,
      "metadata": {
        "description": "Web search via Brave",
        "category": "search",
        "tags": ["web", "search"]
      }
    },
    "database": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "DATABASE_URL": "${DATABASE_URL}"
      },
      "enabled": true,
      "metadata": {
        "description": "PostgreSQL database operations",
        "category": "database",
        "tags": ["db", "sql"]
      }
    },
    "slack": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-slack"],
      "env": {
        "SLACK_TOKEN": "${SLACK_TOKEN}"
      },
      "enabled": false,
      "metadata": {
        "description": "Slack integration",
        "category": "communication",
        "tags": ["slack", "chat"]
      }
    }
  },
  "settings": {
    "autoStart": true,
    "reconnectOnFailure": true,
    "healthCheckInterval": 60000,
    "timeout": 30000
  }
}
```

**特徴**:
- ✅ Claude Desktopの設定と**ほぼ同じ形式**（コピペ可能）
- ✅ 環境変数の展開をサポート
- ✅ `enabled` フラグで有効/無効を切り替え
- ✅ メタデータでカテゴリやタグを追加（オプション）

#### 1.2 最小構成

必須項目のみの最小構成：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    }
  }
}
```

これだけでOK！

### 2. MCP Client Manager

#### 2.1 実装設計

```typescript
// src/mcp/mcp-client-manager.ts

import { spawn, ChildProcess } from 'child_process';

export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  metadata?: {
    description?: string;
    category?: string;
    tags?: string[];
  };
}

export interface MCPServersConfig {
  mcpServers: Record<string, MCPServerConfig>;
  settings?: {
    autoStart?: boolean;
    reconnectOnFailure?: boolean;
    healthCheckInterval?: number;
    timeout?: number;
  };
}

export class MCPClientManager {
  private clients: Map<string, MCPClient>;
  private config: MCPServersConfig;

  constructor(configPath: string) {
    this.clients = new Map();
    this.loadConfig(configPath);
  }

  /**
   * 設定ファイルを読み込み
   */
  async loadConfig(configPath: string): Promise<void> {
    const fs = require('fs').promises;
    const content = await fs.readFile(configPath, 'utf-8');

    // 環境変数を展開
    const expandedContent = this.expandEnvVars(content);
    this.config = JSON.parse(expandedContent);

    // 有効なサーバーを自動起動
    if (this.config.settings?.autoStart !== false) {
      await this.startAll();
    }
  }

  /**
   * 環境変数を展開
   */
  private expandEnvVars(content: string): string {
    return content.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      return process.env[varName] || match;
    });
  }

  /**
   * すべてのMCPサーバーを起動
   */
  async startAll(): Promise<void> {
    for (const [name, config] of Object.entries(this.config.mcpServers)) {
      if (config.enabled !== false) {
        await this.start(name);
      }
    }
  }

  /**
   * MCPサーバーを起動
   */
  async start(name: string): Promise<void> {
    const config = this.config.mcpServers[name];
    if (!config) {
      throw new Error(`MCP server not found: ${name}`);
    }

    if (this.clients.has(name)) {
      console.log(`MCP server already running: ${name}`);
      return;
    }

    const client = new MCPClient(name, config);
    await client.connect();

    this.clients.set(name, client);
    console.log(`✅ MCP server started: ${name}`);
  }

  /**
   * MCPサーバーを停止
   */
  async stop(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (!client) {
      return;
    }

    await client.disconnect();
    this.clients.delete(name);
    console.log(`⏹️  MCP server stopped: ${name}`);
  }

  /**
   * すべてのツールを取得（軽量版）
   */
  async listAllTools(): Promise<AggregatedToolMetadata[]> {
    const tools: AggregatedToolMetadata[] = [];

    for (const [serverName, client] of this.clients) {
      const serverTools = await client.listTools();

      for (const tool of serverTools) {
        tools.push({
          ...tool,
          serverName,
          serverCategory: this.config.mcpServers[serverName].metadata?.category,
          serverTags: this.config.mcpServers[serverName].metadata?.tags
        });
      }
    }

    return tools;
  }

  /**
   * ツールを実行
   */
  async executeTool(
    serverName: string,
    toolName: string,
    parameters: Record<string, any>
  ): Promise<any> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server not running: ${serverName}`);
    }

    return await client.executeTool(toolName, parameters);
  }

  /**
   * ヘルスチェック
   */
  async healthCheck(): Promise<Record<string, boolean>> {
    const status: Record<string, boolean> = {};

    for (const [name, client] of this.clients) {
      try {
        await client.ping();
        status[name] = true;
      } catch (error) {
        status[name] = false;

        // 再接続を試みる
        if (this.config.settings?.reconnectOnFailure !== false) {
          console.log(`Reconnecting to ${name}...`);
          await this.stop(name);
          await this.start(name);
        }
      }
    }

    return status;
  }

  /**
   * 統計情報
   */
  getStats(): {
    totalServers: number;
    runningServers: number;
    totalTools: number;
  } {
    return {
      totalServers: Object.keys(this.config.mcpServers).length,
      runningServers: this.clients.size,
      totalTools: Array.from(this.clients.values()).reduce(
        (sum, client) => sum + client.getToolCount(),
        0
      )
    };
  }
}
```

#### 2.2 MCP Client実装

```typescript
// src/mcp/mcp-client.ts

export class MCPClient {
  private process: ChildProcess | null = null;
  private connected: boolean = false;
  private tools: ToolMetadata[] = [];

  constructor(
    private name: string,
    private config: MCPServerConfig
  ) {}

  /**
   * MCPサーバーに接続
   */
  async connect(): Promise<void> {
    // プロセスを起動
    this.process = spawn(this.config.command, this.config.args || [], {
      env: {
        ...process.env,
        ...this.config.env
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // エラーハンドリング
    this.process.on('error', (error) => {
      console.error(`MCP server error (${this.name}):`, error);
      this.connected = false;
    });

    this.process.on('exit', (code) => {
      console.log(`MCP server exited (${this.name}): ${code}`);
      this.connected = false;
    });

    // MCP初期化メッセージを送信
    await this.sendMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '1.0.0',
        clientInfo: {
          name: 'search-mcp',
          version: '1.0.0'
        }
      }
    });

    // ツール一覧を取得
    await this.fetchTools();

    this.connected = true;
  }

  /**
   * MCPサーバーから切断
   */
  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.connected = false;
  }

  /**
   * ツール一覧を取得
   */
  async listTools(): Promise<ToolMetadata[]> {
    if (this.tools.length === 0) {
      await this.fetchTools();
    }
    return this.tools;
  }

  /**
   * ツール一覧を取得（内部）
   */
  private async fetchTools(): Promise<void> {
    const response = await this.sendMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    });

    this.tools = response.result.tools || [];
  }

  /**
   * ツールを実行
   */
  async executeTool(
    toolName: string,
    parameters: Record<string, any>
  ): Promise<any> {
    const response = await this.sendMessage({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: parameters
      }
    });

    return response.result;
  }

  /**
   * Ping（ヘルスチェック）
   */
  async ping(): Promise<void> {
    await this.sendMessage({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'ping',
      params: {}
    });
  }

  /**
   * MCPサーバーにメッセージを送信
   */
  private async sendMessage(message: any): Promise<any> {
    if (!this.process || !this.connected) {
      throw new Error(`MCP server not connected: ${this.name}`);
    }

    return new Promise((resolve, reject) => {
      const messageStr = JSON.stringify(message) + '\n';

      // レスポンスを待機
      const timeout = setTimeout(() => {
        reject(new Error('Request timeout'));
      }, 30000);

      const onData = (data: Buffer) => {
        clearTimeout(timeout);
        try {
          const response = JSON.parse(data.toString());
          resolve(response);
        } catch (error) {
          reject(error);
        }
        this.process!.stdout!.off('data', onData);
      };

      this.process.stdout!.on('data', onData);

      // メッセージ送信
      this.process.stdin!.write(messageStr);
    });
  }

  /**
   * ツール数を取得
   */
  getToolCount(): number {
    return this.tools.length;
  }
}
```

### 3. API統合

#### 3.1 ツール一覧取得（軽量版）

```typescript
// src/index.ts

const mcpManager = new MCPClientManager('./config/mcp-servers.json');

// 軽量なツール一覧を返す
server.get('/v1/tools', async (request, reply) => {
  const tools = await mcpManager.listAllTools();

  // 必要最小限の情報だけを返す
  return {
    tools: tools.map(tool => ({
      name: `${tool.serverName}.${tool.name}`,  // filesystem.read_file
      description: tool.description,
      server: tool.serverName,
      category: tool.serverCategory,
      // パラメータ詳細は省略（必要時のみ取得）
      parametersCount: tool.parameters?.length || 0
    }))
  };
});

// ツール詳細取得
server.get<{ Params: { toolName: string } }>(
  '/v1/tools/:toolName',
  async (request, reply) => {
    const { toolName } = request.params;
    const [serverName, name] = toolName.split('.');

    const client = mcpManager.getClient(serverName);
    const tools = await client.listTools();
    const tool = tools.find(t => t.name === name);

    if (!tool) {
      return reply.code(404).send({ error: 'Tool not found' });
    }

    return {
      ...tool,
      server: serverName
    };
  }
);

// ツール実行
server.post<{
  Body: {
    name: string;
    parameters: Record<string, any>;
  };
}>(
  '/v1/tools/call',
  async (request, reply) => {
    const { name, parameters } = request.body;
    const [serverName, toolName] = name.split('.');

    const result = await mcpManager.executeTool(serverName, toolName, parameters);

    return {
      success: true,
      result
    };
  }
);
```

### 4. 設定移行ツール

#### 4.1 既存設定からの変換

```typescript
// src/cli/migrate.ts

export class ConfigMigrator {
  /**
   * Claude Desktop設定を変換
   */
  async migrateFromClaudeDesktop(): Promise<void> {
    // Claude Desktop設定を読み込み
    const claudeConfigPath = this.getClaudeDesktopConfigPath();
    const claudeConfig = JSON.parse(
      await fs.readFile(claudeConfigPath, 'utf-8')
    );

    // Search MCP形式に変換（ほぼそのまま使える）
    const searchMcpConfig: MCPServersConfig = {
      mcpServers: claudeConfig.mcpServers || {},
      settings: {
        autoStart: true,
        reconnectOnFailure: true
      }
    };

    // Search MCP設定を保存
    const searchMcpConfigPath = './config/mcp-servers.json';
    await fs.writeFile(
      searchMcpConfigPath,
      JSON.stringify(searchMcpConfig, null, 2)
    );

    console.log('✅ Migration completed!');
    console.log(`Config saved to: ${searchMcpConfigPath}`);
  }
}
```

```bash
# 移行コマンド
search-mcp migrate --from claude-desktop

# 出力例
✅ Found 4 MCP servers in Claude Desktop config
✅ Migration completed!
📝 Config saved to: ./config/mcp-servers.json

Next steps:
1. Review the config file
2. Update Claude Desktop config to use search-mcp only
```

### 5. Claude CLI設定の更新

移行後、Claude Desktopの設定を更新：

**変更前**:
```json
{
  "mcpServers": {
    "filesystem": { ... },
    "brave-search": { ... },
    "database": { ... },
    "slack": { ... }
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

たった1つのエントリだけ！

### 6. 使用フロー

#### 6.1 初回セットアップ

```bash
# Step 1: Search MCPをインストール
npm install -g search-mcp

# Step 2: 既存設定を移行
search-mcp migrate --from claude-desktop

# Step 3: Search MCPを起動
search-mcp start

# Step 4: Claude Desktop設定を更新
search-mcp setup --replace-all

# Step 5: Claude Desktopを再起動
```

#### 6.2 新しいMCPサーバーを追加

```bash
# 方法A: 手動で編集
vi ~/.search-mcp/servers.json

# 方法B: CLIで追加
search-mcp mcp add github \
  --command npx \
  --args "-y,@modelcontextprotocol/server-github" \
  --env "GITHUB_TOKEN=${GITHUB_TOKEN}"

# サーバーを再起動（ホットリロード対応予定）
search-mcp restart
```

### 7. コンテキスト削減の実測

#### 7.1 削減効果

**従来**（4つのMCPサーバーを直接接続）:
```
初期読み込み:
- filesystem: 50 tools × 200 tokens = 10,000 tokens
- brave-search: 20 tools × 200 tokens = 4,000 tokens
- database: 30 tools × 200 tokens = 6,000 tokens
- slack: 15 tools × 200 tokens = 3,000 tokens
合計: 23,000 tokens
```

**Search MCP経由**:
```
初期読み込み（軽量版）:
- ツール名とサーバー名のみ
- 115 tools × 50 tokens = 5,750 tokens

詳細読み込み（必要時のみ）:
- 使用するツールのみフェッチ
- 例: 3 tools × 200 tokens = 600 tokens

合計: 6,350 tokens (72% 削減！)
```

#### 7.2 段階的な情報取得

```
1. 初期: GET /v1/tools
   → 軽量なツール一覧（名前、説明、サーバー名のみ）

2. ツール選択後: GET /v1/tools/{toolName}
   → 詳細なパラメータ情報

3. 実行: POST /v1/tools/call
   → ツールを実行
```

### 8. 実装優先順位

#### Phase 1: 基本アグリゲーション
- [ ] MCPServerConfig型定義
- [ ] 設定ファイルの読み込み
- [ ] MCPClientManagerの実装
- [ ] MCPClientの実装（stdio通信）
- [ ] 基本的なツール一覧取得

#### Phase 2: 管理機能
- [ ] 移行ツール（migrate コマンド）
- [ ] MCPサーバーの追加/削除CLI
- [ ] ヘルスチェック
- [ ] 自動再接続

#### Phase 3: 最適化
- [ ] キャッシング
- [ ] 並列ツール実行
- [ ] ホットリロード

## まとめ

**Search MCP Aggregatorの特徴**:

1. ✅ **既存設定をほぼそのまま使用可能**
   - Claude Desktopの `mcpServers` をコピペするだけ

2. ✅ **コンテキスト消費を大幅削減**
   - 70-80% のコンテキスト削減
   - 段階的な情報取得

3. ✅ **簡単な移行**
   - `search-mcp migrate` で既存設定を変換
   - CLIは Search MCP 1つだけ接続すればOK

4. ✅ **管理が容易**
   - 1つの設定ファイルで全MCPを管理
   - 有効/無効の切り替えが簡単

これで正しいユースケースに合った設計になりました！
