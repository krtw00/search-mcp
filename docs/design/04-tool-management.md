# ツール管理機能設計

## 概要

ツールのライフサイクル全体を管理する機能を設計します。このドキュメントでは、以下のツール管理機能の詳細設計を記述します：

1. ツールの動的登録
2. バージョン管理
3. 依存関係管理
4. ツールのライフサイクル管理
5. ツール設定管理
6. ツールのホットリロード

## 1. ツールの動的登録

### 1.1 概要

サーバーを再起動せずに、実行時にツールを登録・削除できる機能を提供します。

### 1.2 実装設計

#### 1.2.1 動的登録API

```typescript
// src/tool-management/dynamic-registry.ts

export interface ToolDefinition {
  metadata: ToolMetadata;
  implementation: string | ToolImplementation;  // コード文字列またはランタイム関数
  source?: 'file' | 'api' | 'plugin';
}

export class DynamicToolRegistry extends ToolRegistry {
  /**
   * APIからツールを動的に登録
   */
  async registerFromApi(definition: ToolDefinition): Promise<void> {
    // 実装が文字列の場合、評価して関数に変換
    let implementation: ToolImplementation;

    if (typeof definition.implementation === 'string') {
      implementation = this.compileImplementation(definition.implementation);
    } else {
      implementation = definition.implementation;
    }

    // メタデータのバリデーション
    this.validateMetadata(definition.metadata);

    // 登録
    this.register(definition.metadata, implementation, {
      version: definition.metadata.version || '1.0.0',
      tags: definition.metadata.tags,
      category: definition.metadata.category
    });

    // 登録イベントを発行
    this.emit('tool:registered', definition.metadata.name);
  }

  /**
   * ファイルからツールを登録
   */
  async registerFromFile(filePath: string): Promise<void> {
    const module = await import(filePath);

    if (!module.metadata || !module.implementation) {
      throw new Error(`Invalid tool file: ${filePath}`);
    }

    await this.registerFromApi({
      metadata: module.metadata,
      implementation: module.implementation,
      source: 'file'
    });
  }

  /**
   * ディレクトリから複数のツールを登録
   */
  async registerFromDirectory(dirPath: string): Promise<void> {
    const fs = require('fs').promises;
    const path = require('path');

    const files = await fs.readdir(dirPath);

    for (const file of files) {
      if (file.endsWith('.js') || file.endsWith('.ts')) {
        const filePath = path.join(dirPath, file);
        try {
          await this.registerFromFile(filePath);
        } catch (error) {
          console.error(`Failed to register tool from ${file}:`, error);
        }
      }
    }
  }

  /**
   * ツールの登録を解除
   */
  unregisterTool(name: string): void {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    this.tools.delete(name);
    this.emit('tool:unregistered', name);
  }

  /**
   * 文字列のコードを関数にコンパイル
   */
  private compileImplementation(code: string): ToolImplementation {
    try {
      // eslint-disable-next-line no-new-func
      const func = new Function('parameters', `
        return (async () => {
          ${code}
        })();
      `);

      return async (parameters: Record<string, any>) => {
        return await func(parameters);
      };
    } catch (error) {
      throw new Error(`Failed to compile tool implementation: ${error.message}`);
    }
  }

  /**
   * メタデータのバリデーション
   */
  private validateMetadata(metadata: ToolMetadata): void {
    if (!metadata.name || typeof metadata.name !== 'string') {
      throw new Error('Tool name is required and must be a string');
    }

    if (!metadata.description || typeof metadata.description !== 'string') {
      throw new Error('Tool description is required and must be a string');
    }

    if (!Array.isArray(metadata.parameters)) {
      throw new Error('Tool parameters must be an array');
    }

    // パラメータのバリデーション
    for (const param of metadata.parameters) {
      if (!param.name || !param.type || !param.description) {
        throw new Error(`Invalid parameter definition in tool ${metadata.name}`);
      }
    }
  }
}
```

#### 1.2.2 APIエンドポイント

```typescript
// src/index.ts

// ツールの動的登録
server.post<{ Body: ToolDefinition }>(
  '/v1/admin/tools',
  {
    preHandler: requirePermission(Permission.TOOLS_MANAGE),
    schema: {
      body: {
        type: 'object',
        required: ['metadata', 'implementation'],
        properties: {
          metadata: {
            type: 'object',
            required: ['name', 'description', 'parameters'],
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              parameters: { type: 'array' },
              version: { type: 'string' },
              category: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } }
            }
          },
          implementation: { type: 'string' }
        }
      }
    }
  },
  async (request, reply) => {
    try {
      await dynamicRegistry.registerFromApi(request.body);

      return {
        success: true,
        message: `Tool ${request.body.metadata.name} registered successfully`
      };
    } catch (error) {
      return reply.code(400).send({
        success: false,
        error: error.message
      });
    }
  }
);

// ツールの登録解除
server.delete<{ Params: { name: string } }>(
  '/v1/admin/tools/:name',
  {
    preHandler: requirePermission(Permission.TOOLS_MANAGE)
  },
  async (request, reply) => {
    try {
      dynamicRegistry.unregisterTool(request.params.name);

      return {
        success: true,
        message: `Tool ${request.params.name} unregistered successfully`
      };
    } catch (error) {
      return reply.code(404).send({
        success: false,
        error: error.message
      });
    }
  }
);
```

## 2. バージョン管理

### 2.1 概要

ツールの複数バージョンを管理し、特定のバージョンを実行できる機能を提供します。

### 2.2 実装設計

#### 2.2.1 バージョン管理システム

```typescript
// src/tool-management/version-manager.ts

export interface VersionedTool {
  metadata: ToolMetadata;
  implementation: ToolImplementation;
  version: string;
  deprecated?: boolean;
  releaseDate: Date;
  changelog?: string;
}

export class ToolVersionManager {
  private versions: Map<string, Map<string, VersionedTool>>;

  constructor() {
    this.versions = new Map();
  }

  /**
   * ツールのバージョンを登録
   */
  registerVersion(tool: VersionedTool): void {
    const { name } = tool.metadata;

    if (!this.versions.has(name)) {
      this.versions.set(name, new Map());
    }

    const toolVersions = this.versions.get(name)!;
    toolVersions.set(tool.version, tool);
  }

  /**
   * 特定のバージョンを取得
   */
  getVersion(name: string, version: string): VersionedTool | undefined {
    return this.versions.get(name)?.get(version);
  }

  /**
   * 最新バージョンを取得
   */
  getLatestVersion(name: string): VersionedTool | undefined {
    const toolVersions = this.versions.get(name);
    if (!toolVersions || toolVersions.size === 0) {
      return undefined;
    }

    const versions = Array.from(toolVersions.values());
    return versions.reduce((latest, current) => {
      return this.compareVersions(current.version, latest.version) > 0
        ? current
        : latest;
    });
  }

  /**
   * すべてのバージョンを取得
   */
  getAllVersions(name: string): VersionedTool[] {
    const toolVersions = this.versions.get(name);
    if (!toolVersions) {
      return [];
    }

    return Array.from(toolVersions.values()).sort((a, b) =>
      this.compareVersions(b.version, a.version)
    );
  }

  /**
   * バージョンを非推奨にマーク
   */
  deprecateVersion(name: string, version: string): void {
    const tool = this.getVersion(name, version);
    if (tool) {
      tool.deprecated = true;
    }
  }

  /**
   * バージョン番号の比較（セマンティックバージョニング）
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;

      if (part1 > part2) return 1;
      if (part1 < part2) return -1;
    }

    return 0;
  }

  /**
   * バージョン範囲で検索（例: "^1.0.0", "~2.1.0"）
   */
  findVersions(name: string, range: string): VersionedTool[] {
    const allVersions = this.getAllVersions(name);
    // 簡易実装（完全な実装はsemverライブラリを使用）
    return allVersions.filter(tool => {
      if (range.startsWith('^')) {
        // Major version一致
        const major = range.slice(1).split('.')[0];
        return tool.version.startsWith(major + '.');
      } else if (range.startsWith('~')) {
        // Minor version一致
        const [major, minor] = range.slice(1).split('.');
        return tool.version.startsWith(`${major}.${minor}.`);
      } else {
        // 完全一致
        return tool.version === range;
      }
    });
  }
}
```

#### 2.2.2 バージョン指定での実行API

```typescript
// src/index.ts

// バージョン指定でツールを実行
server.post<{
  Body: {
    name: string;
    version?: string;
    parameters: Record<string, any>;
  };
}>(
  '/v1/tools/call-version',
  async (request, reply) => {
    const { name, version, parameters } = request.body;

    try {
      let tool: VersionedTool | undefined;

      if (version) {
        tool = versionManager.getVersion(name, version);
      } else {
        tool = versionManager.getLatestVersion(name);
      }

      if (!tool) {
        return reply.code(404).send({
          success: false,
          error: `Tool ${name} version ${version || 'latest'} not found`
        });
      }

      if (tool.deprecated) {
        reply.header('X-Tool-Deprecated', 'true');
      }

      const result = await tool.implementation(parameters);

      return {
        success: true,
        result,
        version: tool.version
      };
    } catch (error) {
      return reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  }
);

// ツールのバージョン一覧取得
server.get<{ Params: { name: string } }>(
  '/v1/tools/:name/versions',
  async (request, reply) => {
    const { name } = request.params;
    const versions = versionManager.getAllVersions(name);

    if (versions.length === 0) {
      return reply.code(404).send({
        error: `Tool not found: ${name}`
      });
    }

    return {
      tool: name,
      versions: versions.map(v => ({
        version: v.version,
        deprecated: v.deprecated,
        releaseDate: v.releaseDate,
        changelog: v.changelog
      }))
    };
  }
);
```

## 3. 依存関係管理

### 3.1 概要

ツール間の依存関係を管理し、必要なツールが自動的にロードされる機能を提供します。

### 3.2 実装設計

```typescript
// src/tool-management/dependency-manager.ts

export interface ToolDependency {
  name: string;
  version?: string;
  optional?: boolean;
}

export class DependencyManager {
  private dependencies: Map<string, ToolDependency[]>;

  constructor(private registry: ToolRegistry) {
    this.dependencies = new Map();
  }

  /**
   * ツールの依存関係を登録
   */
  registerDependencies(toolName: string, dependencies: ToolDependency[]): void {
    this.dependencies.set(toolName, dependencies);
  }

  /**
   * 依存関係を解決
   */
  async resolveDependencies(toolName: string): Promise<string[]> {
    const resolved: string[] = [];
    const seen = new Set<string>();

    const resolve = async (name: string): Promise<void> => {
      if (seen.has(name)) {
        return; // 循環依存を防ぐ
      }

      seen.add(name);

      const deps = this.dependencies.get(name) || [];
      for (const dep of deps) {
        // 依存ツールが存在するか確認
        const depTool = this.registry.get(dep.name);
        if (!depTool && !dep.optional) {
          throw new Error(`Required dependency not found: ${dep.name}`);
        }

        if (depTool) {
          await resolve(dep.name);
          resolved.push(dep.name);
        }
      }
    };

    await resolve(toolName);
    return resolved;
  }

  /**
   * 依存関係グラフを取得
   */
  getDependencyGraph(toolName: string): Record<string, string[]> {
    const graph: Record<string, string[]> = {};
    const visited = new Set<string>();

    const buildGraph = (name: string): void => {
      if (visited.has(name)) {
        return;
      }

      visited.add(name);

      const deps = this.dependencies.get(name) || [];
      graph[name] = deps.map(d => d.name);

      for (const dep of deps) {
        buildGraph(dep.name);
      }
    };

    buildGraph(toolName);
    return graph;
  }

  /**
   * 循環依存をチェック
   */
  hasCircularDependency(toolName: string): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (name: string): boolean => {
      visited.add(name);
      recursionStack.add(name);

      const deps = this.dependencies.get(name) || [];
      for (const dep of deps) {
        if (!visited.has(dep.name)) {
          if (hasCycle(dep.name)) {
            return true;
          }
        } else if (recursionStack.has(dep.name)) {
          return true;
        }
      }

      recursionStack.delete(name);
      return false;
    };

    return hasCycle(toolName);
  }

  /**
   * 依存関係を検証
   */
  validateDependencies(toolName: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 循環依存チェック
    if (this.hasCircularDependency(toolName)) {
      errors.push('Circular dependency detected');
    }

    // 必須依存関係の存在チェック
    const deps = this.dependencies.get(toolName) || [];
    for (const dep of deps) {
      if (!dep.optional && !this.registry.get(dep.name)) {
        errors.push(`Required dependency not found: ${dep.name}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
```

## 4. ツールのライフサイクル管理

### 4.1 概要

ツールの初期化、実行、クリーンアップなどのライフサイクルを管理します。

### 4.2 実装設計

```typescript
// src/tool-management/lifecycle-manager.ts

export interface ToolLifecycle {
  onInit?: () => Promise<void>;
  onDestroy?: () => Promise<void>;
  onBeforeExecute?: (parameters: Record<string, any>) => Promise<void>;
  onAfterExecute?: (result: any) => Promise<void>;
  onError?: (error: Error) => Promise<void>;
}

export class ToolLifecycleManager {
  private lifecycles: Map<string, ToolLifecycle>;
  private initialized: Set<string>;

  constructor() {
    this.lifecycles = new Map();
    this.initialized = new Set();
  }

  /**
   * ライフサイクルフックを登録
   */
  registerLifecycle(toolName: string, lifecycle: ToolLifecycle): void {
    this.lifecycles.set(toolName, lifecycle);
  }

  /**
   * ツールを初期化
   */
  async initTool(toolName: string): Promise<void> {
    if (this.initialized.has(toolName)) {
      return;
    }

    const lifecycle = this.lifecycles.get(toolName);
    if (lifecycle?.onInit) {
      await lifecycle.onInit();
    }

    this.initialized.add(toolName);
  }

  /**
   * ツールを破棄
   */
  async destroyTool(toolName: string): Promise<void> {
    const lifecycle = this.lifecycles.get(toolName);
    if (lifecycle?.onDestroy) {
      await lifecycle.onDestroy();
    }

    this.initialized.delete(toolName);
  }

  /**
   * ツールを実行（ライフサイクルフック付き）
   */
  async executeTool(
    toolName: string,
    implementation: ToolImplementation,
    parameters: Record<string, any>
  ): Promise<any> {
    // 初期化
    await this.initTool(toolName);

    const lifecycle = this.lifecycles.get(toolName);

    try {
      // 実行前フック
      if (lifecycle?.onBeforeExecute) {
        await lifecycle.onBeforeExecute(parameters);
      }

      // 実行
      const result = await implementation(parameters);

      // 実行後フック
      if (lifecycle?.onAfterExecute) {
        await lifecycle.onAfterExecute(result);
      }

      return result;
    } catch (error) {
      // エラーフック
      if (lifecycle?.onError) {
        await lifecycle.onError(error as Error);
      }

      throw error;
    }
  }

  /**
   * すべてのツールをクリーンアップ
   */
  async cleanup(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const toolName of this.initialized) {
      promises.push(this.destroyTool(toolName));
    }

    await Promise.all(promises);
  }
}
```

## 5. ツール設定管理

### 5.1 概要

ツールごとの設定を管理する機能を提供します。

### 5.2 実装設計

```typescript
// src/tool-management/config-manager.ts

export interface ToolConfig {
  enabled: boolean;
  timeout?: number;
  maxRetries?: number;
  cache?: {
    enabled: boolean;
    ttl: number;
  };
  customSettings?: Record<string, any>;
}

export class ToolConfigManager {
  private configs: Map<string, ToolConfig>;
  private defaultConfig: ToolConfig = {
    enabled: true,
    timeout: 30000,
    maxRetries: 0,
    cache: {
      enabled: false,
      ttl: 300
    }
  };

  constructor() {
    this.configs = new Map();
  }

  /**
   * ツールの設定を登録
   */
  setConfig(toolName: string, config: Partial<ToolConfig>): void {
    const existing = this.configs.get(toolName) || { ...this.defaultConfig };
    this.configs.set(toolName, { ...existing, ...config });
  }

  /**
   * ツールの設定を取得
   */
  getConfig(toolName: string): ToolConfig {
    return this.configs.get(toolName) || { ...this.defaultConfig };
  }

  /**
   * ツールを有効化
   */
  enableTool(toolName: string): void {
    const config = this.getConfig(toolName);
    config.enabled = true;
    this.configs.set(toolName, config);
  }

  /**
   * ツールを無効化
   */
  disableTool(toolName: string): void {
    const config = this.getConfig(toolName);
    config.enabled = false;
    this.configs.set(toolName, config);
  }

  /**
   * 設定をファイルから読み込み
   */
  async loadFromFile(filePath: string): Promise<void> {
    const fs = require('fs').promises;
    const content = await fs.readFile(filePath, 'utf-8');
    const configs = JSON.parse(content);

    for (const [toolName, config] of Object.entries(configs)) {
      this.setConfig(toolName, config as ToolConfig);
    }
  }

  /**
   * 設定をファイルに保存
   */
  async saveToFile(filePath: string): Promise<void> {
    const fs = require('fs').promises;
    const configs = Object.fromEntries(this.configs);
    await fs.writeFile(filePath, JSON.stringify(configs, null, 2));
  }
}
```

## 6. ツールのホットリロード

### 6.1 概要

サーバーを再起動せずに、ツールの実装を更新できる機能を提供します。

### 6.2 実装設計

```typescript
// src/tool-management/hot-reload.ts

import { watch } from 'fs';

export class HotReloadManager {
  private watchers: Map<string, any>;

  constructor(private registry: DynamicToolRegistry) {
    this.watchers = new Map();
  }

  /**
   * ディレクトリを監視
   */
  watchDirectory(dirPath: string): void {
    const watcher = watch(dirPath, { recursive: true }, async (eventType, filename) => {
      if (!filename || !filename.match(/\.(js|ts)$/)) {
        return;
      }

      console.log(`File ${filename} changed, reloading...`);

      try {
        // モジュールキャッシュをクリア
        const fullPath = require('path').join(dirPath, filename);
        delete require.cache[require.resolve(fullPath)];

        // ツールを再登録
        await this.registry.registerFromFile(fullPath);

        console.log(`Tool from ${filename} reloaded successfully`);
      } catch (error) {
        console.error(`Failed to reload tool from ${filename}:`, error);
      }
    });

    this.watchers.set(dirPath, watcher);
  }

  /**
   * 監視を停止
   */
  stopWatching(dirPath: string): void {
    const watcher = this.watchers.get(dirPath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(dirPath);
    }
  }

  /**
   * すべての監視を停止
   */
  stopAll(): void {
    for (const [dirPath] of this.watchers) {
      this.stopWatching(dirPath);
    }
  }
}
```

## 7. 管理APIエンドポイント

```typescript
// src/index.ts

// ツールの有効化
server.patch<{ Params: { name: string } }>(
  '/v1/admin/tools/:name/enable',
  {
    preHandler: requirePermission(Permission.TOOLS_MANAGE)
  },
  async (request, reply) => {
    configManager.enableTool(request.params.name);
    return { success: true, message: `Tool ${request.params.name} enabled` };
  }
);

// ツールの無効化
server.patch<{ Params: { name: string } }>(
  '/v1/admin/tools/:name/disable',
  {
    preHandler: requirePermission(Permission.TOOLS_MANAGE)
  },
  async (request, reply) => {
    configManager.disableTool(request.params.name);
    return { success: true, message: `Tool ${request.params.name} disabled` };
  }
);

// ツールの設定更新
server.patch<{
  Params: { name: string };
  Body: Partial<ToolConfig>;
}>(
  '/v1/admin/tools/:name/config',
  {
    preHandler: requirePermission(Permission.TOOLS_MANAGE)
  },
  async (request, reply) => {
    configManager.setConfig(request.params.name, request.body);
    return { success: true, config: configManager.getConfig(request.params.name) };
  }
);

// 依存関係グラフ取得
server.get<{ Params: { name: string } }>(
  '/v1/tools/:name/dependencies',
  async (request, reply) => {
    const graph = dependencyManager.getDependencyGraph(request.params.name);
    return { tool: request.params.name, dependencies: graph };
  }
);
```

## 8. 実装優先順位

### Phase 4: ツール管理
- [ ] 動的登録APIの実装
- [ ] バージョン管理システム
- [ ] 依存関係マネージャー
- [ ] ライフサイクルマネージャー
- [ ] 設定管理システム

### Phase 5: 高度な管理
- [ ] ホットリロード機能
- [ ] ツールのプラグインシステム
- [ ] ツールのマーケットプレイス連携

## 次のステップ

1. DynamicToolRegistryの実装
2. ToolVersionManagerの実装
3. DependencyManagerの実装
4. ToolLifecycleManagerの実装
5. ToolConfigManagerの実装
6. 管理APIエンドポイントの追加
7. テストの作成

[次へ: パフォーマンス・監視機能設計](./05-performance-monitoring.md)
