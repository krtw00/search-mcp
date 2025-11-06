# パフォーマンス・監視機能設計

## 概要

Search MCP Serverの性能を最適化し、運用状況を監視する機能を設計します。このドキュメントでは、以下の機能の詳細設計を記述します：

1. キャッシング戦略
2. 非同期・並列処理
3. ロギング
4. メトリクス収集
5. 分散トレーシング
6. ヘルスチェック
7. パフォーマンスプロファイリング

## 1. キャッシング戦略

### 1.1 概要

ツールの実行結果やメタデータをキャッシュし、レスポンス時間を短縮します。

### 1.2 実装設計

#### 1.2.1 メモリキャッシュ

```typescript
// src/performance/cache-manager.ts

export interface CacheEntry<T> {
  value: T;
  createdAt: number;
  expiresAt: number;
  hits: number;
}

export interface CacheOptions {
  ttl: number;        // Time to live (ミリ秒)
  maxSize?: number;   // 最大エントリ数
  strategy?: 'LRU' | 'LFU' | 'FIFO';
}

export class CacheManager<T> {
  private cache: Map<string, CacheEntry<T>>;
  private options: Required<CacheOptions>;

  constructor(options: CacheOptions) {
    this.cache = new Map();
    this.options = {
      ttl: options.ttl,
      maxSize: options.maxSize || 1000,
      strategy: options.strategy || 'LRU'
    };

    // 定期的にクリーンアップ
    setInterval(() => this.cleanup(), 60000); // 1分ごと
  }

  /**
   * キャッシュに値を設定
   */
  set(key: string, value: T, ttl?: number): void {
    const now = Date.now();
    const expiresAt = now + (ttl || this.options.ttl);

    // 最大サイズをチェック
    if (this.cache.size >= this.options.maxSize) {
      this.evict();
    }

    this.cache.set(key, {
      value,
      createdAt: now,
      expiresAt,
      hits: 0
    });
  }

  /**
   * キャッシュから値を取得
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    // 期限切れチェック
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // ヒット数を増やす
    entry.hits++;

    return entry.value;
  }

  /**
   * キャッシュをクリア
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * キャッシュから削除
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * キャッシュの統計情報
   */
  getStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
  } {
    let totalHits = 0;
    let totalRequests = 0;

    for (const entry of this.cache.values()) {
      totalHits += entry.hits;
      totalRequests += entry.hits + 1; // +1 for initial set
    }

    return {
      size: this.cache.size,
      maxSize: this.options.maxSize,
      hitRate: totalRequests > 0 ? totalHits / totalRequests : 0
    };
  }

  /**
   * 期限切れエントリをクリーンアップ
   */
  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * エビクション（退避）戦略
   */
  private evict(): void {
    if (this.cache.size === 0) {
      return;
    }

    let keyToEvict: string | undefined;

    switch (this.options.strategy) {
      case 'LRU': // Least Recently Used
        keyToEvict = this.findLRUKey();
        break;
      case 'LFU': // Least Frequently Used
        keyToEvict = this.findLFUKey();
        break;
      case 'FIFO': // First In First Out
        keyToEvict = this.cache.keys().next().value;
        break;
    }

    if (keyToEvict) {
      this.cache.delete(keyToEvict);
    }
  }

  private findLRUKey(): string | undefined {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    return oldestKey;
  }

  private findLFUKey(): string | undefined {
    let leastUsedKey: string | undefined;
    let leastHits = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.hits < leastHits) {
        leastHits = entry.hits;
        leastUsedKey = key;
      }
    }

    return leastUsedKey;
  }
}
```

#### 1.2.2 ツール実行結果のキャッシュ

```typescript
// src/performance/tool-cache.ts

export class ToolResultCache {
  private cache: CacheManager<any>;

  constructor(options: CacheOptions) {
    this.cache = new CacheManager(options);
  }

  /**
   * キャッシュキーを生成
   */
  private generateKey(toolName: string, parameters: Record<string, any>): string {
    const paramString = JSON.stringify(parameters, Object.keys(parameters).sort());
    return `${toolName}:${paramString}`;
  }

  /**
   * ツール実行結果をキャッシュ
   */
  cacheResult(
    toolName: string,
    parameters: Record<string, any>,
    result: any,
    ttl?: number
  ): void {
    const key = this.generateKey(toolName, parameters);
    this.cache.set(key, result, ttl);
  }

  /**
   * キャッシュから結果を取得
   */
  getCachedResult(
    toolName: string,
    parameters: Record<string, any>
  ): any | undefined {
    const key = this.generateKey(toolName, parameters);
    return this.cache.get(key);
  }

  /**
   * ツールのキャッシュをクリア
   */
  clearToolCache(toolName: string): void {
    // ツール名で始まるすべてのキーを削除
    for (const key of Array.from(this.cache['cache'].keys())) {
      if (key.startsWith(`${toolName}:`)) {
        this.cache.delete(key);
      }
    }
  }
}
```

#### 1.2.3 キャッシュミドルウェア

```typescript
// src/performance/cache-middleware.ts

export function createCacheMiddleware(
  toolCache: ToolResultCache,
  configManager: ToolConfigManager
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.method !== 'POST' || !request.url.includes('/tools/call')) {
      return;
    }

    const { name, parameters } = request.body as any;

    // ツールのキャッシュ設定を取得
    const config = configManager.getConfig(name);
    if (!config.cache?.enabled) {
      return;
    }

    // キャッシュから結果を取得
    const cachedResult = toolCache.getCachedResult(name, parameters);
    if (cachedResult) {
      reply.header('X-Cache-Hit', 'true');
      return reply.send({
        success: true,
        result: cachedResult,
        cached: true
      });
    }

    reply.header('X-Cache-Hit', 'false');
  };
}
```

## 2. 非同期・並列処理

### 2.1 概要

複数のツールを並列実行し、処理速度を向上させます。

### 2.2 実装設計

#### 2.2.1 並列実行エンジン

```typescript
// src/performance/parallel-executor.ts

export interface ParallelTask {
  toolName: string;
  parameters: Record<string, any>;
}

export interface ParallelResult {
  toolName: string;
  success: boolean;
  result?: any;
  error?: string;
  executionTime: number;
}

export class ParallelExecutor {
  constructor(
    private registry: ToolRegistry,
    private maxConcurrency: number = 5
  ) {}

  /**
   * 複数のツールを並列実行
   */
  async executeParallel(tasks: ParallelTask[]): Promise<ParallelResult[]> {
    const results: ParallelResult[] = [];
    const executing: Promise<void>[] = [];

    for (const task of tasks) {
      const promise = this.executeTask(task).then(result => {
        results.push(result);
      });

      executing.push(promise);

      // 最大同時実行数に達したら待機
      if (executing.length >= this.maxConcurrency) {
        await Promise.race(executing);
        executing.splice(
          executing.findIndex(p => p === promise),
          1
        );
      }
    }

    // 残りのタスクを待機
    await Promise.all(executing);

    return results;
  }

  /**
   * 単一タスクを実行
   */
  private async executeTask(task: ParallelTask): Promise<ParallelResult> {
    const startTime = Date.now();

    try {
      const result = await this.registry.execute(task.toolName, task.parameters);
      const executionTime = Date.now() - startTime;

      return {
        toolName: task.toolName,
        success: true,
        result,
        executionTime
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;

      return {
        toolName: task.toolName,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime
      };
    }
  }

  /**
   * ツールをバッチ実行
   */
  async executeBatch(
    toolName: string,
    parametersArray: Record<string, any>[]
  ): Promise<ParallelResult[]> {
    const tasks = parametersArray.map(parameters => ({
      toolName,
      parameters
    }));

    return this.executeParallel(tasks);
  }
}
```

#### 2.2.2 APIエンドポイント

```typescript
// src/index.ts

// 並列実行エンドポイント
server.post<{ Body: { tasks: ParallelTask[] } }>(
  '/v1/tools/execute-parallel',
  async (request, reply) => {
    const { tasks } = request.body;

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return reply.code(400).send({
        success: false,
        error: 'Tasks array is required'
      });
    }

    const parallelExecutor = new ParallelExecutor(toolRegistry, 5);
    const results = await parallelExecutor.executeParallel(tasks);

    return {
      success: true,
      results
    };
  }
);

// バッチ実行エンドポイント
server.post<{
  Body: {
    toolName: string;
    parametersArray: Record<string, any>[];
  };
}>(
  '/v1/tools/execute-batch',
  async (request, reply) => {
    const { toolName, parametersArray } = request.body;

    if (!toolName || !Array.isArray(parametersArray)) {
      return reply.code(400).send({
        success: false,
        error: 'toolName and parametersArray are required'
      });
    }

    const parallelExecutor = new ParallelExecutor(toolRegistry, 5);
    const results = await parallelExecutor.executeBatch(toolName, parametersArray);

    return {
      success: true,
      toolName,
      results
    };
  }
);
```

## 3. ロギング

### 3.1 概要

構造化ログを記録し、問題の診断とデバッグを容易にします。

### 3.2 実装設計

#### 3.2.1 ロガー設定

```typescript
// src/monitoring/logger.ts

import pino from 'pino';

export function createLogger(config: {
  level: string;
  prettyPrint?: boolean;
  destination?: string;
}) {
  const logger = pino({
    level: config.level,
    ...(config.prettyPrint && {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname'
        }
      }
    }),
    serializers: {
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
      err: pino.stdSerializers.err
    }
  });

  // ファイルへの出力
  if (config.destination) {
    const destination = pino.destination({
      dest: config.destination,
      sync: false
    });
    return pino(logger.bindings(), destination);
  }

  return logger;
}

// Fastifyロガー設定
export const fastifyLoggerConfig = {
  logger: createLogger({
    level: process.env.LOG_LEVEL || 'info',
    prettyPrint: process.env.NODE_ENV === 'development',
    destination: process.env.LOG_FILE
  })
};
```

#### 3.2.2 リクエストロギング

```typescript
// src/monitoring/request-logger-plugin.ts

import { FastifyPluginAsync } from 'fastify';

const requestLoggerPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request) => {
    request.log.info({
      method: request.method,
      url: request.url,
      ip: request.ip,
      userAgent: request.headers['user-agent']
    }, 'Incoming request');
  });

  fastify.addHook('onResponse', async (request, reply) => {
    request.log.info({
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTime: reply.getResponseTime()
    }, 'Request completed');
  });

  fastify.addHook('onError', async (request, reply, error) => {
    request.log.error({
      method: request.method,
      url: request.url,
      error: {
        message: error.message,
        stack: error.stack,
        code: (error as any).code
      }
    }, 'Request error');
  });
};

export default requestLoggerPlugin;
```

#### 3.2.3 ツール実行ログ

```typescript
// src/monitoring/tool-execution-logger.ts

export class ToolExecutionLogger {
  constructor(private logger: pino.Logger) {}

  /**
   * ツール実行開始をログ
   */
  logExecutionStart(toolName: string, parameters: Record<string, any>): void {
    this.logger.info({
      event: 'tool.execution.start',
      toolName,
      parameters
    });
  }

  /**
   * ツール実行完了をログ
   */
  logExecutionComplete(
    toolName: string,
    executionTime: number,
    success: boolean
  ): void {
    this.logger.info({
      event: 'tool.execution.complete',
      toolName,
      executionTime,
      success
    });
  }

  /**
   * ツール実行エラーをログ
   */
  logExecutionError(toolName: string, error: Error, executionTime: number): void {
    this.logger.error({
      event: 'tool.execution.error',
      toolName,
      executionTime,
      error: {
        message: error.message,
        stack: error.stack
      }
    });
  }
}
```

## 4. メトリクス収集

### 4.1 概要

パフォーマンスメトリクスを収集し、Prometheusなどの監視システムにエクスポートします。

### 4.2 実装設計

#### 4.2.1 メトリクスコレクター

```typescript
// src/monitoring/metrics-collector.ts

import { Counter, Histogram, Gauge, register } from 'prom-client';

export class MetricsCollector {
  // カウンター
  private requestCounter: Counter;
  private toolExecutionCounter: Counter;
  private errorCounter: Counter;

  // ヒストグラム
  private requestDuration: Histogram;
  private toolExecutionDuration: Histogram;

  // ゲージ
  private activeRequests: Gauge;
  private cacheSize: Gauge;

  constructor() {
    // リクエスト数
    this.requestCounter = new Counter({
      name: 'mcp_http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'path', 'status']
    });

    // ツール実行数
    this.toolExecutionCounter = new Counter({
      name: 'mcp_tool_executions_total',
      help: 'Total number of tool executions',
      labelNames: ['tool_name', 'status']
    });

    // エラー数
    this.errorCounter = new Counter({
      name: 'mcp_errors_total',
      help: 'Total number of errors',
      labelNames: ['type', 'tool_name']
    });

    // リクエスト処理時間
    this.requestDuration = new Histogram({
      name: 'mcp_http_request_duration_ms',
      help: 'HTTP request duration in milliseconds',
      labelNames: ['method', 'path', 'status'],
      buckets: [10, 50, 100, 500, 1000, 5000]
    });

    // ツール実行時間
    this.toolExecutionDuration = new Histogram({
      name: 'mcp_tool_execution_duration_ms',
      help: 'Tool execution duration in milliseconds',
      labelNames: ['tool_name'],
      buckets: [10, 50, 100, 500, 1000, 5000, 10000]
    });

    // アクティブリクエスト数
    this.activeRequests = new Gauge({
      name: 'mcp_active_requests',
      help: 'Number of active requests'
    });

    // キャッシュサイズ
    this.cacheSize = new Gauge({
      name: 'mcp_cache_size',
      help: 'Number of items in cache'
    });
  }

  /**
   * HTTPリクエストを記録
   */
  recordRequest(method: string, path: string, status: number, duration: number): void {
    this.requestCounter.inc({ method, path, status });
    this.requestDuration.observe({ method, path, status }, duration);
  }

  /**
   * ツール実行を記録
   */
  recordToolExecution(toolName: string, success: boolean, duration: number): void {
    const status = success ? 'success' : 'failure';
    this.toolExecutionCounter.inc({ tool_name: toolName, status });
    this.toolExecutionDuration.observe({ tool_name: toolName }, duration);
  }

  /**
   * エラーを記録
   */
  recordError(type: string, toolName?: string): void {
    this.errorCounter.inc({ type, tool_name: toolName || 'none' });
  }

  /**
   * アクティブリクエスト数を増やす
   */
  incrementActiveRequests(): void {
    this.activeRequests.inc();
  }

  /**
   * アクティブリクエスト数を減らす
   */
  decrementActiveRequests(): void {
    this.activeRequests.dec();
  }

  /**
   * キャッシュサイズを更新
   */
  updateCacheSize(size: number): void {
    this.cacheSize.set(size);
  }

  /**
   * メトリクスをエクスポート
   */
  async getMetrics(): Promise<string> {
    return register.metrics();
  }
}
```

#### 4.2.2 メトリクスミドルウェア

```typescript
// src/monitoring/metrics-middleware.ts

import { FastifyPluginAsync } from 'fastify';

const metricsPlugin: FastifyPluginAsync<{ collector: MetricsCollector }> = async (
  fastify,
  options
) => {
  const { collector } = options;

  // リクエスト開始時
  fastify.addHook('onRequest', async (request) => {
    collector.incrementActiveRequests();
  });

  // レスポンス送信時
  fastify.addHook('onResponse', async (request, reply) => {
    collector.decrementActiveRequests();

    const duration = reply.getResponseTime();
    collector.recordRequest(
      request.method,
      request.routerPath || request.url,
      reply.statusCode,
      duration
    );
  });

  // メトリクスエンドポイント
  fastify.get('/metrics', async (request, reply) => {
    const metrics = await collector.getMetrics();
    reply.type('text/plain').send(metrics);
  });
};

export default metricsPlugin;
```

## 5. ヘルスチェック

### 5.1 概要

サーバーの健全性を確認するエンドポイントを提供します。

### 5.2 実装設計

```typescript
// src/monitoring/health-check.ts

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  checks: {
    [key: string]: {
      status: 'pass' | 'fail' | 'warn';
      message?: string;
      responseTime?: number;
    };
  };
}

export class HealthChecker {
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * ヘルスチェックを実行
   */
  async check(): Promise<HealthStatus> {
    const checks: HealthStatus['checks'] = {};

    // メモリチェック
    checks.memory = await this.checkMemory();

    // ツールレジストリチェック
    checks.tools = await this.checkTools();

    // キャッシュチェック
    checks.cache = await this.checkCache();

    // 総合ステータスを判定
    const status = this.determineOverallStatus(checks);

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      version: process.env.npm_package_version || '1.0.0',
      checks
    };
  }

  /**
   * メモリ使用量をチェック
   */
  private async checkMemory(): Promise<HealthStatus['checks']['memory']> {
    const usage = process.memoryUsage();
    const heapUsedMB = usage.heapUsed / 1024 / 1024;
    const heapTotalMB = usage.heapTotal / 1024 / 1024;
    const usagePercent = (heapUsedMB / heapTotalMB) * 100;

    if (usagePercent > 90) {
      return {
        status: 'fail',
        message: `Memory usage critical: ${usagePercent.toFixed(2)}%`
      };
    } else if (usagePercent > 80) {
      return {
        status: 'warn',
        message: `Memory usage high: ${usagePercent.toFixed(2)}%`
      };
    }

    return {
      status: 'pass',
      message: `Memory usage: ${usagePercent.toFixed(2)}%`
    };
  }

  /**
   * ツールレジストリをチェック
   */
  private async checkTools(): Promise<HealthStatus['checks']['tools']> {
    // ツールが正常に登録されているかチェック
    const toolCount = toolRegistry.list().length;

    if (toolCount === 0) {
      return {
        status: 'warn',
        message: 'No tools registered'
      };
    }

    return {
      status: 'pass',
      message: `${toolCount} tools registered`
    };
  }

  /**
   * キャッシュをチェック
   */
  private async checkCache(): Promise<HealthStatus['checks']['cache']> {
    // キャッシュの状態をチェック
    return {
      status: 'pass',
      message: 'Cache operational'
    };
  }

  /**
   * 総合ステータスを判定
   */
  private determineOverallStatus(
    checks: HealthStatus['checks']
  ): HealthStatus['status'] {
    const statuses = Object.values(checks).map(check => check.status);

    if (statuses.some(s => s === 'fail')) {
      return 'unhealthy';
    } else if (statuses.some(s => s === 'warn')) {
      return 'degraded';
    }

    return 'healthy';
  }
}

// エンドポイント
server.get('/health', async (request, reply) => {
  const healthChecker = new HealthChecker();
  const health = await healthChecker.check();

  const statusCode = health.status === 'healthy' ? 200 : 503;

  return reply.code(statusCode).send(health);
});
```

## 6. パフォーマンスプロファイリング

### 6.1 概要

ボトルネックを特定するためのプロファイリング機能を提供します。

### 6.2 実装設計

```typescript
// src/monitoring/profiler.ts

export interface ProfileData {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  children: ProfileData[];
}

export class Profiler {
  private stack: ProfileData[];
  private root: ProfileData;

  constructor(name: string = 'root') {
    this.root = {
      name,
      startTime: Date.now(),
      children: []
    };
    this.stack = [this.root];
  }

  /**
   * プロファイリング開始
   */
  start(name: string): void {
    const current = this.stack[this.stack.length - 1];
    const profile: ProfileData = {
      name,
      startTime: Date.now(),
      children: []
    };

    current.children.push(profile);
    this.stack.push(profile);
  }

  /**
   * プロファイリング終了
   */
  end(): void {
    if (this.stack.length > 1) {
      const current = this.stack.pop()!;
      current.endTime = Date.now();
      current.duration = current.endTime - current.startTime;
    }
  }

  /**
   * プロファイルデータを取得
   */
  getProfile(): ProfileData {
    this.root.endTime = Date.now();
    this.root.duration = this.root.endTime - this.root.startTime;
    return this.root;
  }

  /**
   * プロファイルデータを整形して表示
   */
  printProfile(profile: ProfileData = this.root, indent: number = 0): string {
    const prefix = '  '.repeat(indent);
    let output = `${prefix}${profile.name}: ${profile.duration}ms\n`;

    for (const child of profile.children) {
      output += this.printProfile(child, indent + 1);
    }

    return output;
  }
}
```

## 7. 実装優先順位

### Phase 3: 基本監視
- [ ] ロギング設定
- [ ] 基本メトリクス収集
- [ ] ヘルスチェックエンドポイント
- [ ] メモリキャッシュ実装

### Phase 4: 高度な監視
- [ ] Prometheusメトリクスエクスポート
- [ ] 並列実行機能
- [ ] 詳細なプロファイリング

### Phase 5: エンタープライズ監視
- [ ] 分散トレーシング（OpenTelemetry）
- [ ] リアルタイムダッシュボード
- [ ] アラート機能

## 次のステップ

1. CacheManagerの実装
2. MetricsCollectorの実装
3. HealthCheckerの実装
4. ParallelExecutorの実装
5. ロギングプラグインの設定
6. メトリクスエンドポイントの追加

[次へ: 拡張機能設計](./06-extension-features.md)
