# 拡張機能設計

## 概要

Search MCP Serverの機能を拡張するための高度な機能を設計します。このドキュメントでは、以下の拡張機能の詳細設計を記述します：

1. プラグインシステム
2. ツールの合成
3. 外部実行環境連携（Docker）
4. ワークフローエンジン
5. イベントシステム
6. WebHook統合

## 1. プラグインシステム

### 1.1 概要

サーバーの機能を拡張するためのプラグインシステムを提供します。

### 1.2 実装設計

#### 1.2.1 プラグインインターフェース

```typescript
// src/extensions/plugin-system.ts

export interface PluginMetadata {
  name: string;
  version: string;
  description: string;
  author?: string;
  dependencies?: string[];
}

export interface PluginContext {
  registry: ToolRegistry;
  server: FastifyInstance;
  logger: pino.Logger;
  config: any;
}

export interface Plugin {
  metadata: PluginMetadata;
  install: (context: PluginContext) => Promise<void>;
  uninstall?: (context: PluginContext) => Promise<void>;
}

export class PluginManager {
  private plugins: Map<string, Plugin>;
  private installedPlugins: Set<string>;

  constructor(private context: PluginContext) {
    this.plugins = new Map();
    this.installedPlugins = new Set();
  }

  /**
   * プラグインを登録
   */
  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.metadata.name)) {
      throw new Error(`Plugin already registered: ${plugin.metadata.name}`);
    }

    this.plugins.set(plugin.metadata.name, plugin);
    this.context.logger.info(`Plugin registered: ${plugin.metadata.name}`);
  }

  /**
   * プラグインをインストール
   */
  async install(pluginName: string): Promise<void> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginName}`);
    }

    if (this.installedPlugins.has(pluginName)) {
      throw new Error(`Plugin already installed: ${pluginName}`);
    }

    // 依存関係をチェック
    if (plugin.metadata.dependencies) {
      for (const dep of plugin.metadata.dependencies) {
        if (!this.installedPlugins.has(dep)) {
          throw new Error(`Missing dependency: ${dep}`);
        }
      }
    }

    // インストール
    await plugin.install(this.context);
    this.installedPlugins.add(pluginName);

    this.context.logger.info(`Plugin installed: ${pluginName}`);
  }

  /**
   * プラグインをアンインストール
   */
  async uninstall(pluginName: string): Promise<void> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginName}`);
    }

    if (!this.installedPlugins.has(pluginName)) {
      throw new Error(`Plugin not installed: ${pluginName}`);
    }

    // アンインストール
    if (plugin.uninstall) {
      await plugin.uninstall(this.context);
    }

    this.installedPlugins.delete(pluginName);
    this.context.logger.info(`Plugin uninstalled: ${pluginName}`);
  }

  /**
   * インストール済みプラグイン一覧
   */
  listInstalled(): PluginMetadata[] {
    return Array.from(this.installedPlugins)
      .map(name => this.plugins.get(name)!)
      .map(plugin => plugin.metadata);
  }

  /**
   * ファイルからプラグインを読み込み
   */
  async loadFromFile(filePath: string): Promise<void> {
    const module = await import(filePath);

    if (!module.default || typeof module.default !== 'object') {
      throw new Error(`Invalid plugin file: ${filePath}`);
    }

    const plugin = module.default as Plugin;
    this.register(plugin);
  }

  /**
   * ディレクトリからプラグインを読み込み
   */
  async loadFromDirectory(dirPath: string): Promise<void> {
    const fs = require('fs').promises;
    const path = require('path');

    const files = await fs.readdir(dirPath);

    for (const file of files) {
      if (file.endsWith('.js') || file.endsWith('.ts')) {
        const filePath = path.join(dirPath, file);
        try {
          await this.loadFromFile(filePath);
        } catch (error) {
          this.context.logger.error(`Failed to load plugin from ${file}:`, error);
        }
      }
    }
  }
}
```

#### 1.2.2 プラグイン例

```typescript
// plugins/example-plugin.ts

const examplePlugin: Plugin = {
  metadata: {
    name: 'example-plugin',
    version: '1.0.0',
    description: 'An example plugin',
    author: 'Example Author'
  },

  async install(context: PluginContext): Promise<void> {
    const { registry, server, logger } = context;

    // 新しいツールを登録
    registry.register(
      {
        name: 'example-tool',
        description: 'An example tool from plugin',
        parameters: []
      },
      async (parameters) => {
        return { message: 'Hello from plugin!' };
      }
    );

    // 新しいエンドポイントを追加
    server.get('/plugin/example', async (request, reply) => {
      return { message: 'Hello from example plugin!' };
    });

    logger.info('Example plugin installed');
  },

  async uninstall(context: PluginContext): Promise<void> {
    const { logger } = context;
    logger.info('Example plugin uninstalled');
  }
};

export default examplePlugin;
```

## 2. ツールの合成

### 2.1 概要

複数のツールを組み合わせて、新しい機能を作成する機能を提供します。

### 2.2 実装設計

#### 2.2.1 ツール合成エンジン

```typescript
// src/extensions/tool-composition.ts

export interface CompositionStep {
  toolName: string;
  parameters: Record<string, any> | ((previousResults: any[]) => Record<string, any>);
}

export interface CompositionDefinition {
  name: string;
  description: string;
  steps: CompositionStep[];
  outputMapping?: (results: any[]) => any;
}

export class ToolComposer {
  constructor(private registry: ToolRegistry) {}

  /**
   * 複数のツールを合成して実行
   */
  async compose(definition: CompositionDefinition): Promise<any> {
    const results: any[] = [];

    for (const step of definition.steps) {
      // パラメータを解決
      const parameters =
        typeof step.parameters === 'function'
          ? step.parameters(results)
          : step.parameters;

      // ツールを実行
      const result = await this.registry.execute(step.toolName, parameters);
      results.push(result);
    }

    // 出力をマッピング
    if (definition.outputMapping) {
      return definition.outputMapping(results);
    }

    return results;
  }

  /**
   * 合成ツールをツールとして登録
   */
  registerComposition(definition: CompositionDefinition): void {
    const metadata: ToolMetadata = {
      name: definition.name,
      description: definition.description,
      parameters: []
    };

    const implementation: ToolImplementation = async (parameters) => {
      return this.compose(definition);
    };

    this.registry.register(metadata, implementation);
  }
}
```

#### 2.2.2 合成ツールの例

```typescript
// 例: 検索 → フィルター → 集計
const searchAndAggregateComposition: CompositionDefinition = {
  name: 'search-and-aggregate',
  description: 'Search data and aggregate results',
  steps: [
    {
      toolName: 'search',
      parameters: { query: 'sales' }
    },
    {
      toolName: 'filter',
      parameters: (results) => ({
        data: results[0],
        condition: 'amount > 1000'
      })
    },
    {
      toolName: 'aggregate',
      parameters: (results) => ({
        data: results[1],
        operation: 'sum',
        field: 'amount'
      })
    }
  ],
  outputMapping: (results) => ({
    searchResults: results[0],
    filteredResults: results[1],
    aggregation: results[2]
  })
};
```

#### 2.2.3 APIエンドポイント

```typescript
// src/index.ts

// ツール合成実行エンドポイント
server.post<{ Body: CompositionDefinition }>(
  '/v1/tools/compose',
  async (request, reply) => {
    try {
      const composer = new ToolComposer(toolRegistry);
      const result = await composer.compose(request.body);

      return {
        success: true,
        result
      };
    } catch (error) {
      return reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  }
);
```

## 3. 外部実行環境連携（Docker）

### 3.1 概要

Dockerコンテナ内でツールを実行し、隔離された環境を提供します。

### 3.2 実装設計

#### 3.2.1 Docker実行エンジン

```typescript
// src/extensions/docker-executor.ts

import Docker from 'dockerode';

export interface DockerExecutionOptions {
  image: string;
  timeout: number;
  memory: number;      // MB
  cpus: number;
  env?: Record<string, string>;
  volumes?: Array<{ host: string; container: string }>;
}

export class DockerToolExecutor {
  private docker: Docker;

  constructor() {
    this.docker = new Docker();
  }

  /**
   * Dockerコンテナ内でツールを実行
   */
  async execute(
    toolName: string,
    parameters: Record<string, any>,
    options: DockerExecutionOptions
  ): Promise<any> {
    // コンテナを作成
    const container = await this.createContainer(toolName, parameters, options);

    try {
      // コンテナを起動
      await container.start();

      // 結果を待機
      const result = await this.waitForResult(container, options.timeout);

      return result;
    } finally {
      // コンテナをクリーンアップ
      try {
        await container.remove({ force: true });
      } catch (error) {
        console.error('Failed to remove container:', error);
      }
    }
  }

  /**
   * コンテナを作成
   */
  private async createContainer(
    toolName: string,
    parameters: Record<string, any>,
    options: DockerExecutionOptions
  ): Promise<Docker.Container> {
    const env = [
      `TOOL_NAME=${toolName}`,
      `PARAMETERS=${JSON.stringify(parameters)}`,
      ...(options.env ? Object.entries(options.env).map(([k, v]) => `${k}=${v}`) : [])
    ];

    const hostConfig: any = {
      Memory: options.memory * 1024 * 1024,
      NanoCpus: options.cpus * 1e9,
      NetworkMode: 'none'  // ネットワークアクセスを禁止
    };

    // ボリュームマウント
    if (options.volumes) {
      hostConfig.Binds = options.volumes.map(v => `${v.host}:${v.container}`);
    }

    return this.docker.createContainer({
      Image: options.image,
      Cmd: ['node', '/app/execute.js'],
      Env: env,
      HostConfig: hostConfig,
      AttachStdout: true,
      AttachStderr: true
    });
  }

  /**
   * コンテナの実行結果を待機
   */
  private async waitForResult(
    container: Docker.Container,
    timeout: number
  ): Promise<any> {
    return Promise.race([
      this.getContainerOutput(container),
      this.createTimeout(timeout)
    ]);
  }

  /**
   * コンテナの出力を取得
   */
  private async getContainerOutput(container: Docker.Container): Promise<any> {
    // コンテナのログを取得
    const stream = await container.logs({
      stdout: true,
      stderr: true,
      follow: true
    });

    return new Promise((resolve, reject) => {
      let output = '';

      stream.on('data', (chunk) => {
        output += chunk.toString('utf8');
      });

      stream.on('end', () => {
        try {
          // JSON形式で結果を返すことを期待
          const result = JSON.parse(output);
          resolve(result);
        } catch (error) {
          reject(new Error(`Invalid output from container: ${output}`));
        }
      });

      stream.on('error', reject);
    });
  }

  /**
   * タイムアウトプロミス
   */
  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Docker execution timeout after ${ms}ms`));
      }, ms);
    });
  }

  /**
   * イメージをビルド
   */
  async buildImage(
    imageName: string,
    dockerfile: string,
    context: string
  ): Promise<void> {
    const stream = await this.docker.buildImage(
      {
        context,
        src: [dockerfile]
      },
      {
        t: imageName
      }
    );

    return new Promise((resolve, reject) => {
      this.docker.modem.followProgress(stream, (err, res) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 利用可能なイメージ一覧
   */
  async listImages(): Promise<string[]> {
    const images = await this.docker.listImages();
    return images
      .flatMap(image => image.RepoTags || [])
      .filter(tag => tag !== '<none>:<none>');
  }
}
```

#### 3.2.2 Docker実行用のベースイメージ

```dockerfile
# docker/Dockerfile.tool-executor

FROM node:18-alpine

WORKDIR /app

# ツール実行スクリプトをコピー
COPY execute.js /app/

# 依存関係をインストール
RUN npm install

CMD ["node", "execute.js"]
```

```javascript
// docker/execute.js

const toolName = process.env.TOOL_NAME;
const parameters = JSON.parse(process.env.PARAMETERS);

async function main() {
  try {
    // ツールを実行（実装は環境に応じて）
    const result = await executeToolInSandbox(toolName, parameters);

    // 結果をJSON形式で出力
    console.log(JSON.stringify({ success: true, result }));
  } catch (error) {
    console.error(JSON.stringify({
      success: false,
      error: error.message
    }));
    process.exit(1);
  }
}

main();
```

## 4. ワークフローエンジン

### 4.1 概要

複雑なタスクフローを定義・実行するワークフローエンジンを提供します。

### 4.2 実装設計

#### 4.2.1 ワークフロー定義

```typescript
// src/extensions/workflow-engine.ts

export type WorkflowNodeType = 'tool' | 'condition' | 'parallel' | 'loop';

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  config: any;
  next?: string | string[];
}

export interface ToolNode extends WorkflowNode {
  type: 'tool';
  config: {
    toolName: string;
    parameters: Record<string, any> | ((context: WorkflowContext) => Record<string, any>);
  };
}

export interface ConditionNode extends WorkflowNode {
  type: 'condition';
  config: {
    condition: (context: WorkflowContext) => boolean;
    trueNext: string;
    falseNext: string;
  };
}

export interface ParallelNode extends WorkflowNode {
  type: 'parallel';
  config: {
    branches: string[];
  };
}

export interface LoopNode extends WorkflowNode {
  type: 'loop';
  config: {
    condition: (context: WorkflowContext) => boolean;
    body: string;
    maxIterations: number;
  };
}

export interface WorkflowDefinition {
  name: string;
  description: string;
  startNode: string;
  nodes: Map<string, WorkflowNode>;
}

export interface WorkflowContext {
  variables: Map<string, any>;
  results: Map<string, any>;
}

export class WorkflowEngine {
  constructor(private registry: ToolRegistry) {}

  /**
   * ワークフローを実行
   */
  async execute(
    workflow: WorkflowDefinition,
    initialContext?: Partial<WorkflowContext>
  ): Promise<WorkflowContext> {
    const context: WorkflowContext = {
      variables: new Map(initialContext?.variables || []),
      results: new Map(initialContext?.results || [])
    };

    await this.executeNode(workflow, workflow.startNode, context);

    return context;
  }

  /**
   * ノードを実行
   */
  private async executeNode(
    workflow: WorkflowDefinition,
    nodeId: string,
    context: WorkflowContext
  ): Promise<void> {
    const node = workflow.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    switch (node.type) {
      case 'tool':
        await this.executeTool(node as ToolNode, context);
        break;
      case 'condition':
        await this.executeCondition(workflow, node as ConditionNode, context);
        return; // conditionが次のノードを決定
      case 'parallel':
        await this.executeParallel(workflow, node as ParallelNode, context);
        break;
      case 'loop':
        await this.executeLoop(workflow, node as LoopNode, context);
        break;
    }

    // 次のノードを実行
    if (node.next) {
      if (typeof node.next === 'string') {
        await this.executeNode(workflow, node.next, context);
      } else {
        // 複数の次ノード（並列実行）
        await Promise.all(
          node.next.map(nextId => this.executeNode(workflow, nextId, context))
        );
      }
    }
  }

  /**
   * ツールノードを実行
   */
  private async executeTool(node: ToolNode, context: WorkflowContext): Promise<void> {
    const { toolName, parameters } = node.config;

    const params =
      typeof parameters === 'function' ? parameters(context) : parameters;

    const result = await this.registry.execute(toolName, params);
    context.results.set(node.id, result);
  }

  /**
   * 条件ノードを実行
   */
  private async executeCondition(
    workflow: WorkflowDefinition,
    node: ConditionNode,
    context: WorkflowContext
  ): Promise<void> {
    const { condition, trueNext, falseNext } = node.config;

    const result = condition(context);
    const nextNode = result ? trueNext : falseNext;

    await this.executeNode(workflow, nextNode, context);
  }

  /**
   * 並列ノードを実行
   */
  private async executeParallel(
    workflow: WorkflowDefinition,
    node: ParallelNode,
    context: WorkflowContext
  ): Promise<void> {
    const { branches } = node.config;

    await Promise.all(
      branches.map(branchId => this.executeNode(workflow, branchId, context))
    );
  }

  /**
   * ループノードを実行
   */
  private async executeLoop(
    workflow: WorkflowDefinition,
    node: LoopNode,
    context: WorkflowContext
  ): Promise<void> {
    const { condition, body, maxIterations } = node.config;

    let iterations = 0;
    while (condition(context) && iterations < maxIterations) {
      await this.executeNode(workflow, body, context);
      iterations++;
    }
  }
}
```

#### 4.2.2 ワークフロー例

```typescript
// ワークフロー例: データ処理パイプライン
const dataProcessingWorkflow: WorkflowDefinition = {
  name: 'data-processing',
  description: 'Process data through multiple stages',
  startNode: 'fetch',
  nodes: new Map([
    [
      'fetch',
      {
        id: 'fetch',
        type: 'tool',
        config: {
          toolName: 'fetch-data',
          parameters: { source: 'api' }
        },
        next: 'validate'
      } as ToolNode
    ],
    [
      'validate',
      {
        id: 'validate',
        type: 'condition',
        config: {
          condition: (ctx) => ctx.results.get('fetch')?.valid === true,
          trueNext: 'process',
          falseNext: 'error'
        }
      } as ConditionNode
    ],
    [
      'process',
      {
        id: 'process',
        type: 'tool',
        config: {
          toolName: 'process-data',
          parameters: (ctx) => ({
            data: ctx.results.get('fetch').data
          })
        },
        next: 'save'
      } as ToolNode
    ],
    [
      'save',
      {
        id: 'save',
        type: 'tool',
        config: {
          toolName: 'save-data',
          parameters: (ctx) => ({
            data: ctx.results.get('process').result
          })
        }
      } as ToolNode
    ],
    [
      'error',
      {
        id: 'error',
        type: 'tool',
        config: {
          toolName: 'log-error',
          parameters: { message: 'Validation failed' }
        }
      } as ToolNode
    ]
  ])
};
```

## 5. イベントシステム

### 5.1 概要

システム内のイベントを発行・購読する機能を提供します。

### 5.2 実装設計

```typescript
// src/extensions/event-system.ts

import { EventEmitter } from 'events';

export type EventHandler = (...args: any[]) => void | Promise<void>;

export class EventBus extends EventEmitter {
  /**
   * イベントを発行
   */
  publish(eventName: string, ...args: any[]): void {
    this.emit(eventName, ...args);
  }

  /**
   * イベントを購読
   */
  subscribe(eventName: string, handler: EventHandler): void {
    this.on(eventName, handler);
  }

  /**
   * イベントの購読を解除
   */
  unsubscribe(eventName: string, handler: EventHandler): void {
    this.off(eventName, handler);
  }

  /**
   * 一度だけ購読
   */
  subscribeOnce(eventName: string, handler: EventHandler): void {
    this.once(eventName, handler);
  }
}

// システムイベント
export enum SystemEvent {
  TOOL_REGISTERED = 'tool:registered',
  TOOL_UNREGISTERED = 'tool:unregistered',
  TOOL_EXECUTION_START = 'tool:execution:start',
  TOOL_EXECUTION_COMPLETE = 'tool:execution:complete',
  TOOL_EXECUTION_ERROR = 'tool:execution:error',
  SERVER_STARTED = 'server:started',
  SERVER_STOPPED = 'server:stopped'
}
```

## 6. WebHook統合

### 6.1 概要

外部システムにイベントを通知するWebHook機能を提供します。

### 6.2 実装設計

```typescript
// src/extensions/webhook.ts

export interface WebHook {
  id: string;
  url: string;
  events: string[];
  secret?: string;
  enabled: boolean;
}

export class WebHookManager {
  private webhooks: Map<string, WebHook>;

  constructor(private eventBus: EventBus) {
    this.webhooks = new Map();
  }

  /**
   * WebHookを登録
   */
  register(webhook: WebHook): void {
    this.webhooks.set(webhook.id, webhook);

    // イベントリスナーを登録
    for (const event of webhook.events) {
      this.eventBus.subscribe(event, (...args) => {
        this.trigger(webhook, event, args);
      });
    }
  }

  /**
   * WebHookをトリガー
   */
  private async trigger(
    webhook: WebHook,
    event: string,
    data: any[]
  ): Promise<void> {
    if (!webhook.enabled) {
      return;
    }

    try {
      const payload = {
        event,
        timestamp: new Date().toISOString(),
        data
      };

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(webhook.secret && { 'X-Webhook-Secret': webhook.secret })
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        console.error(`WebHook failed: ${webhook.url} - ${response.statusText}`);
      }
    } catch (error) {
      console.error(`WebHook error: ${webhook.url}`, error);
    }
  }

  /**
   * WebHookを削除
   */
  unregister(id: string): void {
    this.webhooks.delete(id);
  }

  /**
   * WebHook一覧
   */
  list(): WebHook[] {
    return Array.from(this.webhooks.values());
  }
}
```

## 7. 実装優先順位

### Phase 5: 拡張機能
- [ ] プラグインシステムの実装
- [ ] ツール合成エンジン
- [ ] Docker実行エンジン
- [ ] ワークフローエンジン
- [ ] イベントシステム
- [ ] WebHook統合

## 8. まとめ

これらの拡張機能により、Search MCP Serverは以下を実現します：

1. **プラグインシステム**: サードパーティによる機能拡張
2. **ツールの合成**: 既存ツールの組み合わせによる新機能の作成
3. **Docker連携**: 安全で隔離された実行環境
4. **ワークフローエンジン**: 複雑なタスクフローの自動化
5. **イベントシステム**: リアクティブな処理の実現
6. **WebHook**: 外部システムとの統合

これらの機能は、Search MCP Serverを強力で柔軟なプラットフォームに変えます。

[完了: すべての設計ドキュメントが完成しました](./00-overview.md)
