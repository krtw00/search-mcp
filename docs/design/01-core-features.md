# コア機能設計

## 概要

Search MCP Serverのコア機能は、システムの基盤となる重要なコンポーネントです。このドキュメントでは、以下のコア機能の詳細設計を記述します：

1. Tool Registry（ツールレジストリ）
2. HTTP API Server
3. ツール実行エンジン
4. エラーハンドリング
5. 型システム

## 1. Tool Registry（ツールレジストリ）

### 1.1 概要

ToolRegistryは、すべてのツールを管理する中央レジストリです。ツールの登録、検索、取得、実行を担当します。

### 1.2 現在の実装

**ファイル**: `src/tool-registry.ts`

```typescript
export class ToolRegistry {
  private tools: Map<string, { metadata: ToolMetadata; implementation: ToolImplementation }>;

  constructor()
  register(metadata: ToolMetadata, implementation: ToolImplementation): void
  list(): ToolMetadata[]
  get(name: string): { metadata, implementation } | undefined
  execute(name: string, parameters: Record<string, any>): Promise<any>
}
```

### 1.3 拡張設計

#### 1.3.1 ツール情報の拡張

現在の実装にツールの追加情報を保持できるように拡張します：

```typescript
interface ToolRegistryEntry {
  metadata: ToolMetadata;
  implementation: ToolImplementation;
  // 以下を追加
  registeredAt: Date;          // 登録日時
  version: string;             // ツールのバージョン
  enabled: boolean;            // 有効/無効フラグ
  tags?: string[];            // タグ（Phase 2）
  dependencies?: string[];     // 依存関係（Phase 4）
  category?: string;          // カテゴリ（Phase 2）
}

export class ToolRegistry {
  private tools: Map<string, ToolRegistryEntry>;

  // 既存メソッド
  register(metadata: ToolMetadata, implementation: ToolImplementation, options?: RegisterOptions): void
  list(filter?: ListFilter): ToolMetadata[]
  get(name: string): ToolRegistryEntry | undefined
  execute(name: string, parameters: Record<string, any>): Promise<any>

  // 新規メソッド（Phase 2以降）
  search(query: string): ToolMetadata[]
  filterByTag(tags: string[]): ToolMetadata[]
  filterByCategory(category: string): ToolMetadata[]
  enable(name: string): void
  disable(name: string): void
  unregister(name: string): void
  getVersion(name: string): string
}
```

#### 1.3.2 登録時のバリデーション

ツール登録時に以下のバリデーションを実施：

```typescript
interface RegisterOptions {
  version?: string;
  tags?: string[];
  category?: string;
  overwrite?: boolean;  // 同名ツールの上書きを許可
}

register(metadata: ToolMetadata, implementation: ToolImplementation, options?: RegisterOptions): void {
  // バリデーション
  if (!metadata.name || metadata.name.trim() === '') {
    throw new Error('Tool name is required');
  }

  if (!/^[a-z][a-z0-9-]*$/.test(metadata.name)) {
    throw new Error('Tool name must start with lowercase letter and contain only lowercase letters, numbers, and hyphens');
  }

  if (this.tools.has(metadata.name) && !options?.overwrite) {
    throw new Error(`Tool "${metadata.name}" is already registered`);
  }

  if (!metadata.description || metadata.description.trim() === '') {
    throw new Error('Tool description is required');
  }

  // 登録処理
  this.tools.set(metadata.name, {
    metadata,
    implementation,
    registeredAt: new Date(),
    version: options?.version || '1.0.0',
    enabled: true,
    tags: options?.tags,
    category: options?.category
  });
}
```

#### 1.3.3 実行時のチェック

ツール実行時に以下をチェック：

```typescript
async execute(name: string, parameters: Record<string, any>): Promise<any> {
  const tool = this.tools.get(name);

  // ツールの存在チェック
  if (!tool) {
    throw new ToolNotFoundError(`Tool not found: ${name}`);
  }

  // 有効性チェック
  if (!tool.enabled) {
    throw new ToolDisabledError(`Tool is disabled: ${name}`);
  }

  // パラメータバリデーション
  this.validateParameters(tool.metadata.parameters, parameters);

  // 実行
  try {
    const result = await tool.implementation(parameters);
    return result;
  } catch (error) {
    throw new ToolExecutionError(`Tool execution failed: ${name}`, error);
  }
}

private validateParameters(schema: ToolParameter[], actual: Record<string, any>): void {
  for (const param of schema) {
    if (param.required && !(param.name in actual)) {
      throw new ValidationError(`Required parameter missing: ${param.name}`);
    }

    // 型チェック（Phase 3で強化）
    if (param.name in actual) {
      const value = actual[param.name];
      if (!this.validateType(value, param.type)) {
        throw new ValidationError(`Invalid type for parameter ${param.name}: expected ${param.type}`);
      }
    }
  }
}
```

## 2. HTTP API Server

### 2.1 現在の実装

**ファイル**: `src/index.ts`

Fastifyベースの3つのエンドポイント：
- `GET /`: ヘルスチェック
- `GET /tools`: ツール一覧取得
- `POST /tools/call`: ツール実行

### 2.2 拡張設計

#### 2.2.1 APIバージョニング

将来の互換性のためにバージョニングを導入：

```typescript
// v1 エンドポイント
const v1 = server.register(async (fastify) => {
  fastify.get('/tools', listToolsHandler);
  fastify.post('/tools/call', callToolHandler);
  fastify.get('/tools/:name', getToolDetailHandler);  // Phase 2
  fastify.post('/tools/search', searchToolsHandler);  // Phase 2
}, { prefix: '/v1' });

// ルートはv1にリダイレクト（後方互換性）
server.get('/tools', (req, reply) => reply.redirect('/v1/tools'));
server.post('/tools/call', (req, reply) => reply.redirect(307, '/v1/tools/call'));
```

#### 2.2.2 エンドポイント詳細設計

##### 2.2.2.1 ヘルスチェック: `GET /`

```typescript
server.get('/', async (request, reply) => {
  return {
    status: 'ok',
    message: 'MCP Server is running',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  };
});
```

##### 2.2.2.2 ツール一覧: `GET /v1/tools`

```typescript
interface ListToolsQuery {
  category?: string;    // Phase 2
  tag?: string;        // Phase 2
  enabled?: boolean;   // Phase 4
  page?: number;       // Phase 2
  limit?: number;      // Phase 2
}

server.get<{ Querystring: ListToolsQuery }>('/v1/tools', {
  schema: {
    querystring: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        tag: { type: 'string' },
        enabled: { type: 'boolean' },
        page: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100 }
      }
    }
  }
}, async (request, reply) => {
  const { category, tag, enabled, page = 1, limit = 50 } = request.query;

  let tools = toolRegistry.list();

  // フィルタリング（Phase 2）
  if (category) {
    tools = tools.filter(t => t.category === category);
  }
  if (tag) {
    tools = tools.filter(t => t.tags?.includes(tag));
  }
  if (enabled !== undefined) {
    tools = tools.filter(t => t.enabled === enabled);
  }

  // ページネーション（Phase 2）
  const total = tools.length;
  const start = (page - 1) * limit;
  const end = start + limit;
  const paginated = tools.slice(start, end);

  return {
    tools: paginated,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
});
```

##### 2.2.2.3 ツール実行: `POST /v1/tools/call`

```typescript
interface CallToolRequest {
  name: string;
  parameters: Record<string, any>;
}

interface CallToolResponse {
  success: boolean;
  result?: any;
  error?: string;
  executionTime?: number;  // ミリ秒
}

server.post<{ Body: CallToolRequest }>('/v1/tools/call', {
  schema: {
    body: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        parameters: { type: 'object' }
      }
    }
  }
}, async (request, reply) => {
  const startTime = Date.now();
  const { name, parameters = {} } = request.body;

  try {
    const result = await toolRegistry.execute(name, parameters);
    const executionTime = Date.now() - startTime;

    return {
      success: true,
      result,
      executionTime
    } as CallToolResponse;
  } catch (error) {
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // エラータイプに応じたステータスコード
    if (error instanceof ToolNotFoundError) {
      reply.code(404);
    } else if (error instanceof ValidationError) {
      reply.code(400);
    } else if (error instanceof ToolDisabledError) {
      reply.code(403);
    } else {
      reply.code(500);
    }

    return {
      success: false,
      error: errorMessage,
      executionTime
    } as CallToolResponse;
  }
});
```

##### 2.2.2.4 ツール詳細取得: `GET /v1/tools/:name` (Phase 2)

```typescript
server.get<{ Params: { name: string } }>('/v1/tools/:name', async (request, reply) => {
  const { name } = request.params;
  const tool = toolRegistry.get(name);

  if (!tool) {
    return reply.code(404).send({
      error: `Tool not found: ${name}`
    });
  }

  return {
    ...tool.metadata,
    version: tool.version,
    enabled: tool.enabled,
    registeredAt: tool.registeredAt,
    tags: tool.tags,
    category: tool.category
  };
});
```

##### 2.2.2.5 ツール検索: `POST /v1/tools/search` (Phase 2)

```typescript
interface SearchToolsRequest {
  query: string;
  filters?: {
    category?: string;
    tags?: string[];
  };
  limit?: number;
}

server.post<{ Body: SearchToolsRequest }>('/v1/tools/search', async (request, reply) => {
  const { query, filters, limit = 20 } = request.body;

  if (!query || query.trim() === '') {
    return reply.code(400).send({
      error: 'Query is required'
    });
  }

  const results = toolRegistry.search(query);
  // フィルタリングとlimit適用

  return {
    query,
    results: results.slice(0, limit),
    total: results.length
  };
});
```

## 3. ツール実行エンジン

### 3.1 概要

ツール実行エンジンは、ツールの実行を管理し、タイムアウト、リトライ、ロギングなどを提供します。

### 3.2 実装設計

```typescript
interface ExecutionOptions {
  timeout?: number;        // タイムアウト（ミリ秒）
  retry?: number;         // リトライ回数
  retryDelay?: number;    // リトライ間隔（ミリ秒）
}

class ToolExecutor {
  async execute(
    implementation: ToolImplementation,
    parameters: Record<string, any>,
    options: ExecutionOptions = {}
  ): Promise<any> {
    const { timeout = 30000, retry = 0, retryDelay = 1000 } = options;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retry; attempt++) {
      try {
        // タイムアウト付き実行
        const result = await this.executeWithTimeout(
          implementation,
          parameters,
          timeout
        );
        return result;
      } catch (error) {
        lastError = error as Error;

        // リトライ可能なエラーかチェック
        if (attempt < retry && this.isRetryable(error)) {
          await this.sleep(retryDelay * (attempt + 1)); // Exponential backoff
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }

  private async executeWithTimeout(
    implementation: ToolImplementation,
    parameters: Record<string, any>,
    timeout: number
  ): Promise<any> {
    return Promise.race([
      implementation(parameters),
      this.timeoutPromise(timeout)
    ]);
  }

  private timeoutPromise(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new TimeoutError(`Execution timeout after ${ms}ms`)), ms);
    });
  }

  private isRetryable(error: any): boolean {
    // ネットワークエラーなど、リトライ可能なエラーを判定
    return error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

## 4. エラーハンドリング

### 4.1 エラークラス階層

```typescript
// 基底エラークラス
export class MCPError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

// ツール関連エラー
export class ToolNotFoundError extends MCPError {
  constructor(message: string) {
    super(message, 'TOOL_NOT_FOUND', 404);
  }
}

export class ToolDisabledError extends MCPError {
  constructor(message: string) {
    super(message, 'TOOL_DISABLED', 403);
  }
}

export class ToolExecutionError extends MCPError {
  constructor(message: string, public originalError?: any) {
    super(message, 'TOOL_EXECUTION_ERROR', 500);
  }
}

// バリデーションエラー
export class ValidationError extends MCPError {
  constructor(message: string, public field?: string) {
    super(message, 'VALIDATION_ERROR', 400);
  }
}

// タイムアウトエラー
export class TimeoutError extends MCPError {
  constructor(message: string) {
    super(message, 'TIMEOUT', 408);
  }
}

// 認証エラー（Phase 3）
export class AuthenticationError extends MCPError {
  constructor(message: string) {
    super(message, 'AUTHENTICATION_ERROR', 401);
  }
}

// 認可エラー（Phase 3）
export class AuthorizationError extends MCPError {
  constructor(message: string) {
    super(message, 'AUTHORIZATION_ERROR', 403);
  }
}

// レート制限エラー（Phase 3）
export class RateLimitError extends MCPError {
  constructor(message: string, public retryAfter?: number) {
    super(message, 'RATE_LIMIT_EXCEEDED', 429);
  }
}
```

### 4.2 グローバルエラーハンドラー

```typescript
// Fastifyエラーハンドラー
server.setErrorHandler((error, request, reply) => {
  // ロギング
  request.log.error({
    err: error,
    url: request.url,
    method: request.method
  });

  // MCPErrorの場合
  if (error instanceof MCPError) {
    return reply.code(error.statusCode).send({
      success: false,
      error: error.message,
      code: error.code
    });
  }

  // Fastifyバリデーションエラー
  if (error.validation) {
    return reply.code(400).send({
      success: false,
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: error.validation
    });
  }

  // 未知のエラー
  return reply.code(500).send({
    success: false,
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : error.message,
    code: 'INTERNAL_ERROR'
  });
});
```

## 5. 型システム

### 5.1 現在の型定義

**ファイル**: `src/types.ts`

### 5.2 拡張型定義

```typescript
// src/types.ts

/**
 * ツールのパラメータ定義
 */
export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  default?: any;           // 追加
  enum?: any[];           // 追加（Phase 3）
  pattern?: string;       // 追加（Phase 3）正規表現
  minimum?: number;       // 追加（Phase 3）数値の最小値
  maximum?: number;       // 追加（Phase 3）数値の最大値
}

/**
 * ツールのメタデータ
 */
export interface ToolMetadata {
  name: string;
  description: string;
  parameters: ToolParameter[];
  version?: string;        // 追加
  category?: string;       // 追加（Phase 2）
  tags?: string[];        // 追加（Phase 2）
  author?: string;        // 追加（Phase 4）
  examples?: ToolExample[]; // 追加（Phase 2）
}

/**
 * ツールの使用例
 */
export interface ToolExample {
  description: string;
  parameters: Record<string, any>;
  expectedResult?: any;
}

/**
 * ツール実行リクエスト
 */
export interface ToolCallRequest {
  name: string;
  parameters: Record<string, any>;
  options?: ExecutionOptions; // 追加（Phase 3）
}

/**
 * ツール実行レスポンス
 */
export interface ToolCallResponse {
  success: boolean;
  result?: any;
  error?: string;
  code?: string;           // 追加
  executionTime?: number;  // 追加（ミリ秒）
  timestamp?: string;      // 追加
}

/**
 * ツール実装の型
 */
export type ToolImplementation = (parameters: Record<string, any>) => Promise<any>;

/**
 * ツールレジストリエントリ
 */
export interface ToolRegistryEntry {
  metadata: ToolMetadata;
  implementation: ToolImplementation;
  registeredAt: Date;
  version: string;
  enabled: boolean;
  tags?: string[];
  category?: string;
  dependencies?: string[];
}
```

## 6. 設定管理

### 6.1 サーバー設定

```typescript
// src/config.ts

export interface ServerConfig {
  port: number;
  host: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  cors?: {
    enabled: boolean;
    origin: string | string[];
  };
  rateLimit?: {
    max: number;
    timeWindow: number;
  };
}

export const defaultConfig: ServerConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  logLevel: (process.env.LOG_LEVEL as any) || 'info',
  cors: {
    enabled: process.env.CORS_ENABLED === 'true',
    origin: process.env.CORS_ORIGIN || '*'
  }
};

export function loadConfig(): ServerConfig {
  // 環境変数から設定を読み込む
  return {
    ...defaultConfig,
    // 追加の設定
  };
}
```

## 7. 実装優先順位

### Phase 1: MVP（現在）
- [x] 基本的なToolRegistry
- [x] 基本的なHTTP API
- [ ] エラークラスの実装
- [ ] 基本的なバリデーション
- [ ] 設定管理

### Phase 2: 機能拡張
- [ ] ツール検索API
- [ ] ページネーション
- [ ] ツール詳細取得API
- [ ] カテゴリとタグのサポート

### Phase 3: 本番対応
- [ ] JSONスキーマバリデーション
- [ ] 詳細なエラーハンドリング
- [ ] タイムアウト機能
- [ ] リトライ機能

## 8. テスト戦略

### 8.1 ユニットテスト

```typescript
// src/tool-registry.test.ts
describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('register', () => {
    it('should register a tool successfully', () => {
      const metadata = { name: 'test', description: 'Test tool', parameters: [] };
      const implementation = async () => ({ result: 'ok' });

      expect(() => registry.register(metadata, implementation)).not.toThrow();
      expect(registry.get('test')).toBeDefined();
    });

    it('should throw error for duplicate tool names', () => {
      const metadata = { name: 'test', description: 'Test tool', parameters: [] };
      const implementation = async () => ({ result: 'ok' });

      registry.register(metadata, implementation);
      expect(() => registry.register(metadata, implementation)).toThrow();
    });
  });

  // 他のテストケース...
});
```

### 8.2 統合テスト

```typescript
// src/index.test.ts
describe('API Server', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await createServer();
  });

  afterAll(async () => {
    await server.close();
  });

  describe('GET /v1/tools', () => {
    it('should return tool list', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/tools'
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('tools');
    });
  });

  // 他のテストケース...
});
```

## 次のステップ

1. エラークラスの実装 (`src/errors.ts`)
2. 設定管理の実装 (`src/config.ts`)
3. ツール実行エンジンの実装 (`src/executor.ts`)
4. ToolRegistryの拡張
5. APIエンドポイントの拡張
6. テストの作成

[次へ: 検索機能設計](./02-search-features.md)
