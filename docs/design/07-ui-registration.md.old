# UI・登録機能設計

## 概要

Search MCP Serverの登録とツール管理のためのUI/UX設計を記述します。2つの主要なユーザーシナリオに対応します：

1. **AIクライアントがMCPサーバーに接続** - エンドユーザーの視点
2. **MCPサーバーにツールを登録** - 開発者・管理者の視点

## 1. ユーザーシナリオ

### シナリオA: エンドユーザー（Claude Desktopユーザー）

**目的**: Search MCP ServerをClaude Desktopに接続したい

**ペルソナ**:
- 名前: 山田太郎
- 役割: データアナリスト
- 技術レベル: 中級（コマンドライン操作は可能）

**フロー**:
```
1. Search MCP Serverをインストール (npm install -g search-mcp)
2. サーバーを起動 (search-mcp start)
3. Claude Desktopの設定ファイルにサーバー情報を追加
4. Claude Desktopを再起動
5. Claudeでツールを使用
```

### シナリオB: 開発者・管理者

**目的**: Search MCP Serverに新しいツールを登録したい

**ペルソナ**:
- 名前: 佐藤花子
- 役割: バックエンドエンジニア
- 技術レベル: 上級

**フロー**:
```
1. ツールを実装 (TypeScriptファイルを作成)
2. 登録方法を選択:
   a. ファイルベース: src/tools/ に配置して再起動
   b. API経由: 管理APIでツールを動的登録
   c. Web UI: 管理画面からツールを登録
3. ツールをテスト
4. 本番環境にデプロイ
```

## 2. AIクライアント接続方法

### 2.1 Claude Desktop設定

#### 2.1.1 設定ファイル形式

**手動設定**:

```json
// ~/Library/Application Support/Claude/claude_desktop_config.json (macOS)
// %APPDATA%/Claude/claude_desktop_config.json (Windows)
{
  "mcpServers": {
    "search-mcp": {
      "command": "node",
      "args": ["/path/to/search-mcp/dist/index.js"],
      "env": {
        "PORT": "3000",
        "LOG_LEVEL": "info",
        "API_KEY": "your-api-key-here"
      }
    }
  }
}
```

**インストーラー使用**:

```bash
# CLIツールで自動設定
search-mcp install --client claude-desktop

# 対話形式でセットアップ
search-mcp setup
```

#### 2.1.2 セットアップCLI

```typescript
// src/cli/setup.ts

import inquirer from 'inquirer';
import fs from 'fs/promises';
import path from 'path';

export interface SetupOptions {
  client: 'claude-desktop' | 'custom';
  port?: number;
  apiKey?: string;
  autoStart?: boolean;
}

export class SetupCLI {
  /**
   * 対話形式でセットアップ
   */
  async interactiveSetup(): Promise<void> {
    console.log('🚀 Search MCP Server Setup\n');

    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'client',
        message: 'Which AI client do you want to configure?',
        choices: [
          { name: 'Claude Desktop', value: 'claude-desktop' },
          { name: 'Custom (manual configuration)', value: 'custom' }
        ]
      },
      {
        type: 'number',
        name: 'port',
        message: 'Port number:',
        default: 3000
      },
      {
        type: 'confirm',
        name: 'useAuth',
        message: 'Enable API key authentication?',
        default: true
      },
      {
        type: 'password',
        name: 'apiKey',
        message: 'API key (leave empty to generate):',
        when: (answers) => answers.useAuth
      },
      {
        type: 'confirm',
        name: 'autoStart',
        message: 'Start server automatically on system startup?',
        default: false
      }
    ]);

    // APIキーを生成
    if (answers.useAuth && !answers.apiKey) {
      answers.apiKey = this.generateApiKey();
      console.log(`\n🔑 Generated API key: ${answers.apiKey}`);
      console.log('⚠️  Please save this key securely!\n');
    }

    // 設定を適用
    await this.applyConfiguration(answers);

    console.log('\n✅ Setup completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Restart Claude Desktop');
    console.log('2. Start using Search MCP Server\n');
  }

  /**
   * Claude Desktop設定を更新
   */
  async applyConfiguration(options: SetupOptions): Promise<void> {
    if (options.client === 'claude-desktop') {
      const configPath = this.getClaudeDesktopConfigPath();
      await this.updateClaudeDesktopConfig(configPath, options);
      console.log(`\n📝 Updated: ${configPath}`);
    } else {
      this.printManualInstructions(options);
    }
  }

  /**
   * Claude Desktop設定ファイルのパスを取得
   */
  private getClaudeDesktopConfigPath(): string {
    const platform = process.platform;

    if (platform === 'darwin') {
      return path.join(
        process.env.HOME!,
        'Library/Application Support/Claude/claude_desktop_config.json'
      );
    } else if (platform === 'win32') {
      return path.join(
        process.env.APPDATA!,
        'Claude/claude_desktop_config.json'
      );
    } else {
      throw new Error('Unsupported platform');
    }
  }

  /**
   * Claude Desktop設定ファイルを更新
   */
  private async updateClaudeDesktopConfig(
    configPath: string,
    options: SetupOptions
  ): Promise<void> {
    let config: any = {};

    // 既存の設定を読み込み
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      config = JSON.parse(content);
    } catch (error) {
      // ファイルが存在しない場合は新規作成
      config = { mcpServers: {} };
    }

    // search-mcp設定を追加
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    const serverPath = path.resolve(__dirname, '../../dist/index.js');

    config.mcpServers['search-mcp'] = {
      command: 'node',
      args: [serverPath],
      env: {
        PORT: options.port?.toString() || '3000',
        LOG_LEVEL: 'info',
        ...(options.apiKey && { API_KEY: options.apiKey })
      }
    };

    // ディレクトリを作成
    await fs.mkdir(path.dirname(configPath), { recursive: true });

    // 設定を保存
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  }

  /**
   * 手動設定の手順を表示
   */
  private printManualInstructions(options: SetupOptions): void {
    console.log('\n📋 Manual Configuration Instructions:\n');
    console.log('Add the following to your AI client configuration:\n');
    console.log(JSON.stringify({
      mcpServers: {
        'search-mcp': {
          command: 'node',
          args: ['path/to/search-mcp/dist/index.js'],
          env: {
            PORT: options.port || 3000,
            LOG_LEVEL: 'info',
            ...(options.apiKey && { API_KEY: options.apiKey })
          }
        }
      }
    }, null, 2));
  }

  /**
   * APIキーを生成
   */
  private generateApiKey(): string {
    const crypto = require('crypto');
    return `mcp_${crypto.randomBytes(32).toString('hex')}`;
  }
}
```

#### 2.1.3 セットアップコマンド

```bash
# 対話形式でセットアップ
$ search-mcp setup

🚀 Search MCP Server Setup

? Which AI client do you want to configure? Claude Desktop
? Port number: 3000
? Enable API key authentication? Yes
? API key (leave empty to generate):

🔑 Generated API key: mcp_a1b2c3d4e5f6...
⚠️  Please save this key securely!

📝 Updated: ~/Library/Application Support/Claude/claude_desktop_config.json

✅ Setup completed successfully!

Next steps:
1. Restart Claude Desktop
2. Start using Search MCP Server

# ワンライナーでセットアップ
$ search-mcp setup --client claude-desktop --port 3000 --auto-start
```

### 2.2 検証ツール

```typescript
// src/cli/verify.ts

export class VerificationCLI {
  /**
   * 接続を検証
   */
  async verify(): Promise<void> {
    console.log('🔍 Verifying Search MCP Server connection...\n');

    const checks = [
      { name: 'Server running', check: () => this.checkServerRunning() },
      { name: 'Configuration valid', check: () => this.checkConfiguration() },
      { name: 'Tools available', check: () => this.checkToolsAvailable() },
      { name: 'Authentication', check: () => this.checkAuthentication() }
    ];

    for (const { name, check } of checks) {
      try {
        await check();
        console.log(`✅ ${name}`);
      } catch (error) {
        console.log(`❌ ${name}: ${error.message}`);
      }
    }

    console.log('\n✅ Verification completed!');
  }

  private async checkServerRunning(): Promise<void> {
    const response = await fetch('http://localhost:3000/');
    if (!response.ok) {
      throw new Error('Server not responding');
    }
  }

  private async checkConfiguration(): Promise<void> {
    // 設定ファイルをチェック
    const configPath = this.getClaudeDesktopConfigPath();
    const config = JSON.parse(await fs.readFile(configPath, 'utf-8'));

    if (!config.mcpServers?.['search-mcp']) {
      throw new Error('search-mcp not configured');
    }
  }

  private async checkToolsAvailable(): Promise<void> {
    const response = await fetch('http://localhost:3000/v1/tools');
    const data = await response.json();

    if (!data.tools || data.tools.length === 0) {
      throw new Error('No tools registered');
    }
  }

  private async checkAuthentication(): Promise<void> {
    // 認証が有効かチェック
    const response = await fetch('http://localhost:3000/v1/tools', {
      headers: { 'X-API-Key': 'invalid-key' }
    });

    if (response.status === 401) {
      // 認証が正しく機能している
      return;
    }
  }
}
```

## 3. ツール登録方法

### 3.1 方法の比較

| 方法 | 難易度 | 柔軟性 | 本番適用 | 使用場面 |
|------|--------|--------|----------|----------|
| ファイルベース | 低 | 中 | ○ | 開発時、静的なツール |
| CLI | 中 | 中 | ○ | 一括登録、スクリプト化 |
| REST API | 中 | 高 | ○ | 動的登録、プログラム連携 |
| Web UI | 低 | 高 | ○ | 非技術者、視覚的管理 |

### 3.2 ファイルベース登録

#### 3.2.1 ツールファイル形式

```typescript
// src/tools/example-tool.ts

import type { ToolMetadata, ToolImplementation } from '../types.js';

// メタデータ
export const metadata: ToolMetadata = {
  name: 'example-tool',
  description: 'An example tool',
  version: '1.0.0',
  category: 'utility',
  tags: ['example', 'demo'],
  parameters: [
    {
      name: 'input',
      type: 'string',
      description: 'Input text',
      required: true
    }
  ],
  examples: [
    {
      description: 'Basic usage',
      parameters: { input: 'hello' },
      expectedResult: { output: 'HELLO' }
    }
  ]
};

// 実装
export const implementation: ToolImplementation = async (parameters) => {
  const { input } = parameters;
  return {
    output: input.toUpperCase(),
    timestamp: new Date().toISOString()
  };
};

// ライフサイクル（オプション）
export const lifecycle = {
  async onInit() {
    console.log('Example tool initialized');
  },
  async onDestroy() {
    console.log('Example tool destroyed');
  }
};
```

#### 3.2.2 自動検出

```typescript
// src/cli/discover.ts

export class ToolDiscoveryCLI {
  /**
   * ツールを自動検出して登録
   */
  async discover(directory: string = './src/tools'): Promise<void> {
    console.log(`🔎 Discovering tools in ${directory}...\n`);

    const files = await this.findToolFiles(directory);

    console.log(`Found ${files.length} tool file(s):\n`);

    for (const file of files) {
      try {
        const tool = await import(file);
        if (tool.metadata && tool.implementation) {
          console.log(`  ✅ ${tool.metadata.name} (${file})`);
          await this.registry.register(tool.metadata, tool.implementation);
        } else {
          console.log(`  ⚠️  Invalid tool format: ${file}`);
        }
      } catch (error) {
        console.log(`  ❌ Error loading ${file}: ${error.message}`);
      }
    }

    console.log(`\n✅ Discovery completed!`);
  }

  private async findToolFiles(directory: string): Promise<string[]> {
    const fs = require('fs').promises;
    const path = require('path');
    const files: string[] = [];

    async function scan(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await scan(fullPath);
        } else if (entry.isFile() && /\.(ts|js)$/.test(entry.name)) {
          files.push(fullPath);
        }
      }
    }

    await scan(directory);
    return files;
  }
}
```

### 3.3 CLI登録

```bash
# 単一ツールを登録
$ search-mcp tool add ./my-tool.ts

# ディレクトリ内のすべてのツールを登録
$ search-mcp tool add-dir ./custom-tools

# JSONファイルからツールを登録
$ search-mcp tool add-json ./tool-definition.json

# ツール一覧を表示
$ search-mcp tool list

# ツールを削除
$ search-mcp tool remove my-tool

# ツールを無効化
$ search-mcp tool disable my-tool

# ツールを有効化
$ search-mcp tool enable my-tool
```

### 3.4 REST API登録

```bash
# ツールを登録
curl -X POST http://localhost:3000/v1/admin/tools \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "metadata": {
      "name": "my-tool",
      "description": "My custom tool",
      "parameters": []
    },
    "implementation": "async (parameters) => { return { result: \"ok\" }; }"
  }'

# ツール一覧を取得
curl http://localhost:3000/v1/tools

# ツールを削除
curl -X DELETE http://localhost:3000/v1/admin/tools/my-tool \
  -H "X-API-Key: your-api-key"
```

### 3.5 Web UI登録

#### 3.5.1 管理画面の構成

```
┌─────────────────────────────────────────┐
│  Search MCP Server - Admin Dashboard   │
├─────────────────────────────────────────┤
│                                         │
│  [Dashboard] [Tools] [Settings] [Logs] │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ Tools Overview                  │   │
│  │                                 │   │
│  │ Total: 10 tools                 │   │
│  │ Active: 8 tools                 │   │
│  │ Disabled: 2 tools               │   │
│  │                                 │   │
│  │ [+ Add New Tool]                │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ Tool List                       │   │
│  ├─────────────────────────────────┤   │
│  │ ● echo         [Edit] [Delete]  │   │
│  │   Simple echo tool              │   │
│  │   v1.0.0 | utility              │   │
│  │                                 │   │
│  │ ● search       [Edit] [Delete]  │   │
│  │   Search data                   │   │
│  │   v1.0.0 | data                 │   │
│  │                                 │   │
│  │ ○ old-tool     [Edit] [Delete]  │   │
│  │   (Disabled)                    │   │
│  │                                 │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

#### 3.5.2 ツール追加フォーム

```html
<!-- Tool Registration Form -->
<form id="tool-form">
  <h2>Add New Tool</h2>

  <!-- 基本情報 -->
  <section>
    <h3>Basic Information</h3>

    <label>Tool Name *</label>
    <input type="text" name="name" pattern="[a-z][a-z0-9-]*" required>
    <small>Lowercase letters, numbers, and hyphens only</small>

    <label>Description *</label>
    <textarea name="description" required></textarea>

    <label>Version</label>
    <input type="text" name="version" value="1.0.0" pattern="\d+\.\d+\.\d+">

    <label>Category</label>
    <select name="category">
      <option value="utility">Utility</option>
      <option value="data">Data</option>
      <option value="ai">AI</option>
      <option value="integration">Integration</option>
    </select>

    <label>Tags</label>
    <input type="text" name="tags" placeholder="tag1, tag2, tag3">
  </section>

  <!-- パラメータ定義 -->
  <section>
    <h3>Parameters</h3>
    <div id="parameters-list">
      <!-- パラメータ入力フィールド -->
    </div>
    <button type="button" onclick="addParameter()">+ Add Parameter</button>
  </section>

  <!-- 実装 -->
  <section>
    <h3>Implementation</h3>

    <label>Implementation Method</label>
    <select name="impl-method" onchange="toggleImplementation()">
      <option value="code">Write Code</option>
      <option value="file">Upload File</option>
      <option value="url">From URL</option>
    </select>

    <!-- コードエディタ -->
    <div id="code-editor">
      <label>Tool Implementation (JavaScript/TypeScript)</label>
      <textarea name="implementation" rows="15" placeholder="async (parameters) => {
  // Your implementation here
  return { result: 'ok' };
}"></textarea>
      <small>Write an async function that receives parameters and returns a result</small>
    </div>

    <!-- ファイルアップロード -->
    <div id="file-upload" style="display:none;">
      <label>Upload Tool File</label>
      <input type="file" name="file" accept=".js,.ts">
    </div>

    <!-- URL入力 -->
    <div id="url-input" style="display:none;">
      <label>Tool File URL</label>
      <input type="url" name="url" placeholder="https://example.com/tool.js">
    </div>
  </section>

  <!-- テスト -->
  <section>
    <h3>Test</h3>
    <button type="button" onclick="testTool()">Test Tool</button>
    <div id="test-result"></div>
  </section>

  <!-- 送信 -->
  <div class="actions">
    <button type="submit" class="primary">Register Tool</button>
    <button type="button" onclick="cancel()">Cancel</button>
  </div>
</form>
```

#### 3.5.3 Web UI実装

```typescript
// src/web-ui/server.ts

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';

export async function startWebUI(port: number = 8080) {
  const server = Fastify({ logger: true });

  // 静的ファイルを提供
  await server.register(fastifyStatic, {
    root: path.join(__dirname, 'public'),
    prefix: '/'
  });

  // API エンドポイント
  server.get('/api/tools', async (request, reply) => {
    const tools = toolRegistry.list();
    return { tools };
  });

  server.post('/api/tools', async (request, reply) => {
    const { metadata, implementation } = request.body as any;

    try {
      await dynamicRegistry.registerFromApi({
        metadata,
        implementation,
        source: 'api'
      });

      return { success: true, message: 'Tool registered successfully' };
    } catch (error) {
      return reply.code(400).send({
        success: false,
        error: error.message
      });
    }
  });

  server.delete('/api/tools/:name', async (request, reply) => {
    const { name } = request.params as any;

    try {
      dynamicRegistry.unregisterTool(name);
      return { success: true, message: 'Tool unregistered successfully' };
    } catch (error) {
      return reply.code(404).send({
        success: false,
        error: error.message
      });
    }
  });

  await server.listen({ port, host: '0.0.0.0' });
  console.log(`Web UI available at http://localhost:${port}`);
}
```

```javascript
// src/web-ui/public/app.js

class ToolManager {
  async loadTools() {
    const response = await fetch('/api/tools');
    const data = await response.json();
    this.renderTools(data.tools);
  }

  renderTools(tools) {
    const container = document.getElementById('tools-list');
    container.innerHTML = tools.map(tool => `
      <div class="tool-card">
        <div class="tool-header">
          <h3>${tool.name}</h3>
          <span class="version">${tool.version || 'v1.0.0'}</span>
        </div>
        <p>${tool.description}</p>
        <div class="tool-meta">
          <span class="category">${tool.category || 'uncategorized'}</span>
          ${tool.tags ? tool.tags.map(tag => `<span class="tag">${tag}</span>`).join('') : ''}
        </div>
        <div class="tool-actions">
          <button onclick="toolManager.editTool('${tool.name}')">Edit</button>
          <button onclick="toolManager.deleteTool('${tool.name}')">Delete</button>
        </div>
      </div>
    `).join('');
  }

  async addTool(formData) {
    const response = await fetch('/api/tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });

    const result = await response.json();

    if (result.success) {
      alert('Tool registered successfully!');
      await this.loadTools();
    } else {
      alert(`Error: ${result.error}`);
    }
  }

  async deleteTool(name) {
    if (!confirm(`Delete tool "${name}"?`)) return;

    const response = await fetch(`/api/tools/${name}`, {
      method: 'DELETE'
    });

    const result = await response.json();

    if (result.success) {
      alert('Tool deleted successfully!');
      await this.loadTools();
    } else {
      alert(`Error: ${result.error}`);
    }
  }
}

const toolManager = new ToolManager();

// ページ読み込み時にツールをロード
document.addEventListener('DOMContentLoaded', () => {
  toolManager.loadTools();
});
```

## 4. 推奨フロー

### 4.1 初回セットアップ（エンドユーザー）

```bash
# ステップ1: インストール
npm install -g search-mcp

# ステップ2: セットアップウィザード
search-mcp setup

# ステップ3: サーバー起動
search-mcp start

# ステップ4: 検証
search-mcp verify
```

### 4.2 ツール追加（開発者）

**開発環境**:
```bash
# ファイルベースで開発
cd search-mcp/src/tools
# 新しいツールファイルを作成
vi my-tool.ts
# サーバーを再起動してテスト
npm run dev
```

**本番環境**:
```bash
# Web UIで登録（推奨）
open http://localhost:8080

# またはCLI
search-mcp tool add ./my-tool.ts
```

## 5. 実装優先順位

### Phase 1: 基本CLI
- [ ] setup コマンド
- [ ] verify コマンド
- [ ] tool list コマンド

### Phase 2: ファイルベース登録
- [ ] 自動検出機能
- [ ] ツールテンプレート生成

### Phase 3: Web UI
- [ ] 管理ダッシュボード
- [ ] ツール追加フォーム
- [ ] ツール編集・削除

### Phase 4: 高度な機能
- [ ] ビジュアルツールビルダー
- [ ] ツールマーケットプレイス連携
- [ ] ワンクリックデプロイ

## 次のステップ

1. CLIツールの実装
2. セットアップウィザードの実装
3. Web UI基盤の構築
4. ドキュメントとチュートリアルの作成

[戻る: 拡張機能設計](./06-extension-features.md)
