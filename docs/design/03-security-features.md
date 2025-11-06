# セキュリティ機能設計

## 概要

Search MCP Serverを本番環境で安全に運用するためのセキュリティ機能を設計します。このドキュメントでは、以下のセキュリティ機能の詳細設計を記述します：

1. 認証・認可
2. レート制限
3. 入力バリデーション
4. サンドボックス実行
5. セキュリティヘッダー
6. 監査ログ

## 1. 認証・認可

### 1.1 概要

APIへのアクセスを制御するための認証・認可機能を提供します。

### 1.2 認証方式

#### 1.2.1 APIキー認証

最もシンプルで実装しやすい認証方式。各クライアントに一意のAPIキーを発行します。

```typescript
// src/auth/api-key-auth.ts

export interface ApiKey {
  key: string;
  name: string;
  permissions: string[];
  createdAt: Date;
  expiresAt?: Date;
  lastUsedAt?: Date;
  enabled: boolean;
}

export class ApiKeyManager {
  private keys: Map<string, ApiKey>;

  constructor() {
    this.keys = new Map();
  }

  /**
   * APIキーを生成
   */
  generateKey(name: string, permissions: string[], expiresIn?: number): ApiKey {
    const key = this.createSecureKey();
    const apiKey: ApiKey = {
      key,
      name,
      permissions,
      createdAt: new Date(),
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn) : undefined,
      enabled: true
    };

    this.keys.set(key, apiKey);
    return apiKey;
  }

  /**
   * APIキーを検証
   */
  validateKey(key: string): ApiKey | null {
    const apiKey = this.keys.get(key);

    if (!apiKey) {
      return null;
    }

    if (!apiKey.enabled) {
      return null;
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      return null;
    }

    // 最終使用日時を更新
    apiKey.lastUsedAt = new Date();

    return apiKey;
  }

  /**
   * APIキーを無効化
   */
  revokeKey(key: string): void {
    const apiKey = this.keys.get(key);
    if (apiKey) {
      apiKey.enabled = false;
    }
  }

  /**
   * 安全なAPIキーを生成
   */
  private createSecureKey(): string {
    const crypto = require('crypto');
    return `mcp_${crypto.randomBytes(32).toString('hex')}`;
  }

  /**
   * 権限チェック
   */
  hasPermission(apiKey: ApiKey, permission: string): boolean {
    return apiKey.permissions.includes('*') || apiKey.permissions.includes(permission);
  }
}
```

#### 1.2.2 Fastify認証プラグイン

```typescript
// src/auth/fastify-auth-plugin.ts

import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { ApiKeyManager } from './api-key-auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: ApiKey;
  }
}

const authPlugin: FastifyPluginAsync<{ apiKeyManager: ApiKeyManager }> = async (
  fastify,
  options
) => {
  const { apiKeyManager } = options;

  fastify.decorateRequest('apiKey', null);

  fastify.addHook('onRequest', async (request, reply) => {
    // 認証不要のエンドポイント
    const publicPaths = ['/', '/health'];
    if (publicPaths.includes(request.url)) {
      return;
    }

    // APIキーを取得（Headerまたはクエリパラメータ）
    const apiKeyString =
      request.headers['x-api-key'] as string ||
      request.headers['authorization']?.replace('Bearer ', '') ||
      (request.query as any)?.api_key;

    if (!apiKeyString) {
      return reply.code(401).send({
        success: false,
        error: 'API key is required',
        code: 'AUTHENTICATION_ERROR'
      });
    }

    // APIキーを検証
    const apiKey = apiKeyManager.validateKey(apiKeyString);
    if (!apiKey) {
      return reply.code(401).send({
        success: false,
        error: 'Invalid or expired API key',
        code: 'AUTHENTICATION_ERROR'
      });
    }

    // リクエストにAPIキー情報を付加
    request.apiKey = apiKey;
  });
};

export default fp(authPlugin);
```

#### 1.2.3 権限ベースのアクセス制御

```typescript
// src/auth/permissions.ts

export enum Permission {
  TOOLS_LIST = 'tools:list',
  TOOLS_READ = 'tools:read',
  TOOLS_EXECUTE = 'tools:execute',
  TOOLS_MANAGE = 'tools:manage',
  ADMIN = 'admin:*'
}

/**
 * 権限チェックデコレータ
 */
export function requirePermission(permission: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.apiKey) {
      return reply.code(401).send({
        success: false,
        error: 'Authentication required',
        code: 'AUTHENTICATION_ERROR'
      });
    }

    const apiKeyManager = request.server.apiKeyManager;
    if (!apiKeyManager.hasPermission(request.apiKey, permission)) {
      return reply.code(403).send({
        success: false,
        error: 'Insufficient permissions',
        code: 'AUTHORIZATION_ERROR',
        required: permission
      });
    }
  };
}
```

#### 1.2.4 エンドポイントでの使用例

```typescript
// src/index.ts

// APIキーマネージャーを初期化
const apiKeyManager = new ApiKeyManager();

// デフォルトのAPIキーを生成（開発用）
if (process.env.NODE_ENV === 'development') {
  apiKeyManager.generateKey('dev-key', ['*']);
}

// 認証プラグインを登録
await server.register(authPlugin, { apiKeyManager });

// 権限が必要なエンドポイント
server.post('/v1/tools/call', {
  preHandler: requirePermission(Permission.TOOLS_EXECUTE)
}, async (request, reply) => {
  // ツール実行処理
});
```

## 2. レート制限

### 2.1 概要

APIへのリクエストを制限し、DoS攻撃やリソースの過剰使用を防ぎます。

### 2.2 実装設計

#### 2.2.1 レート制限マネージャー

```typescript
// src/security/rate-limiter.ts

export interface RateLimitConfig {
  windowMs: number;     // タイムウィンドウ（ミリ秒）
  maxRequests: number;  // ウィンドウ内の最大リクエスト数
}

export class RateLimiter {
  private requests: Map<string, number[]>;

  constructor(private config: RateLimitConfig) {
    this.requests = new Map();
  }

  /**
   * レート制限をチェック
   */
  checkLimit(identifier: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    // 識別子のリクエスト履歴を取得
    let timestamps = this.requests.get(identifier) || [];

    // 古いリクエストを削除
    timestamps = timestamps.filter(ts => ts > windowStart);

    // リクエスト数をチェック
    if (timestamps.length >= this.config.maxRequests) {
      const oldestRequest = timestamps[0];
      const retryAfter = Math.ceil((oldestRequest + this.config.windowMs - now) / 1000);

      return { allowed: false, retryAfter };
    }

    // 新しいリクエストを記録
    timestamps.push(now);
    this.requests.set(identifier, timestamps);

    return { allowed: true };
  }

  /**
   * 定期的なクリーンアップ
   */
  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    for (const [identifier, timestamps] of this.requests.entries()) {
      const validTimestamps = timestamps.filter(ts => ts > windowStart);
      if (validTimestamps.length === 0) {
        this.requests.delete(identifier);
      } else {
        this.requests.set(identifier, validTimestamps);
      }
    }
  }
}
```

#### 2.2.2 Fastifyプラグイン

```typescript
// src/security/fastify-rate-limit-plugin.ts

import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { RateLimiter } from './rate-limiter.js';

const rateLimitPlugin: FastifyPluginAsync<{ rateLimiter: RateLimiter }> = async (
  fastify,
  options
) => {
  const { rateLimiter } = options;

  // 5分ごとにクリーンアップ
  setInterval(() => rateLimiter.cleanup(), 5 * 60 * 1000);

  fastify.addHook('onRequest', async (request, reply) => {
    // 識別子を決定（APIキー > IP アドレス）
    const identifier = request.apiKey?.key || request.ip;

    const result = rateLimiter.checkLimit(identifier);

    if (!result.allowed) {
      reply.header('Retry-After', result.retryAfter!);
      return reply.code(429).send({
        success: false,
        error: 'Rate limit exceeded',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: result.retryAfter
      });
    }

    // レート制限情報をヘッダーに追加
    reply.header('X-RateLimit-Limit', rateLimiter.config.maxRequests);
    reply.header('X-RateLimit-Remaining', result.remaining || 0);
  });
};

export default fp(rateLimitPlugin);
```

#### 2.2.3 エンドポイント別のレート制限

```typescript
// src/security/rate-limit-configs.ts

export const rateLimitConfigs = {
  default: {
    windowMs: 60 * 1000,      // 1分
    maxRequests: 60           // 60リクエスト/分
  },
  toolExecution: {
    windowMs: 60 * 1000,      // 1分
    maxRequests: 10           // 10リクエスト/分
  },
  search: {
    windowMs: 60 * 1000,      // 1分
    maxRequests: 30           // 30リクエスト/分
  }
};

// エンドポイント別のレート制限適用
server.post('/v1/tools/call', {
  config: {
    rateLimit: rateLimitConfigs.toolExecution
  }
}, async (request, reply) => {
  // ツール実行処理
});
```

## 3. 入力バリデーション

### 3.1 概要

すべての入力を厳密にバリデーションし、インジェクション攻撃やデータの不整合を防ぎます。

### 3.2 実装設計

#### 3.2.1 JSONスキーマバリデーション

Fastifyの組み込みバリデーション機能を使用：

```typescript
// src/validation/schemas.ts

export const toolCallSchema = {
  body: {
    type: 'object',
    required: ['name'],
    properties: {
      name: {
        type: 'string',
        minLength: 1,
        maxLength: 100,
        pattern: '^[a-z][a-z0-9-]*$'
      },
      parameters: {
        type: 'object',
        additionalProperties: true
      }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'object' },
        executionTime: { type: 'number' }
      }
    },
    400: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        error: { type: 'string' },
        code: { type: 'string' }
      }
    }
  }
};

export const searchSchema = {
  body: {
    type: 'object',
    required: ['query'],
    properties: {
      query: {
        type: 'string',
        minLength: 1,
        maxLength: 500
      },
      matchType: {
        type: 'string',
        enum: ['partial', 'prefix', 'exact']
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 100
      }
    }
  }
};
```

#### 3.2.2 カスタムバリデーター

```typescript
// src/validation/custom-validators.ts

export class InputValidator {
  /**
   * ツールパラメータのバリデーション
   */
  static validateToolParameters(
    schema: ToolParameter[],
    parameters: Record<string, any>
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const param of schema) {
      const value = parameters[param.name];

      // 必須チェック
      if (param.required && (value === undefined || value === null)) {
        errors.push(`Required parameter missing: ${param.name}`);
        continue;
      }

      // 値が存在する場合のみ型チェック
      if (value !== undefined && value !== null) {
        const typeError = this.validateType(value, param);
        if (typeError) {
          errors.push(typeError);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 型バリデーション
   */
  private static validateType(value: any, param: ToolParameter): string | null {
    switch (param.type) {
      case 'string':
        if (typeof value !== 'string') {
          return `Parameter ${param.name} must be a string`;
        }
        if (param.pattern) {
          const regex = new RegExp(param.pattern);
          if (!regex.test(value)) {
            return `Parameter ${param.name} does not match pattern: ${param.pattern}`;
          }
        }
        break;

      case 'number':
        if (typeof value !== 'number' || isNaN(value)) {
          return `Parameter ${param.name} must be a number`;
        }
        if (param.minimum !== undefined && value < param.minimum) {
          return `Parameter ${param.name} must be >= ${param.minimum}`;
        }
        if (param.maximum !== undefined && value > param.maximum) {
          return `Parameter ${param.name} must be <= ${param.maximum}`;
        }
        break;

      case 'boolean':
        if (typeof value !== 'boolean') {
          return `Parameter ${param.name} must be a boolean`;
        }
        break;

      case 'array':
        if (!Array.isArray(value)) {
          return `Parameter ${param.name} must be an array`;
        }
        break;

      case 'object':
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          return `Parameter ${param.name} must be an object`;
        }
        break;
    }

    return null;
  }

  /**
   * SQLインジェクション対策（将来の拡張）
   */
  static sanitizeSqlInput(input: string): string {
    return input.replace(/['";\\]/g, '');
  }

  /**
   * XSS対策
   */
  static sanitizeHtmlInput(input: string): string {
    return input
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }
}
```

## 4. サンドボックス実行

### 4.1 概要

ツールを隔離された環境で実行し、システムへの影響を最小限に抑えます。

### 4.2 実装設計

#### 4.2.1 VM2を使用したサンドボックス

```typescript
// src/security/sandbox-executor.ts

import { VM } from 'vm2';

export interface SandboxOptions {
  timeout: number;
  memory: number;  // MB
  allowedModules: string[];
}

export class SandboxExecutor {
  /**
   * サンドボックス内でコードを実行
   */
  async execute(
    code: string,
    context: Record<string, any>,
    options: SandboxOptions
  ): Promise<any> {
    const vm = new VM({
      timeout: options.timeout,
      sandbox: context,
      eval: false,
      wasm: false,
      fixAsync: true
    });

    try {
      const result = await vm.run(code);
      return result;
    } catch (error) {
      throw new Error(`Sandbox execution failed: ${error.message}`);
    }
  }

  /**
   * ツールの安全な実行
   */
  async executeTool(
    implementation: ToolImplementation,
    parameters: Record<string, any>,
    options: SandboxOptions
  ): Promise<any> {
    // ツール実装をサンドボックス内で実行
    const code = `
      (async () => {
        const implementation = ${implementation.toString()};
        const result = await implementation(parameters);
        return result;
      })()
    `;

    return this.execute(code, { parameters }, options);
  }
}
```

#### 4.2.2 Docker コンテナでの実行（Phase 5）

```typescript
// src/security/docker-executor.ts

import Docker from 'dockerode';

export class DockerExecutor {
  private docker: Docker;

  constructor() {
    this.docker = new Docker();
  }

  /**
   * Dockerコンテナ内でツールを実行
   */
  async executeTool(
    toolName: string,
    parameters: Record<string, any>,
    options: {
      image: string;
      timeout: number;
      memory: number;
    }
  ): Promise<any> {
    const container = await this.docker.createContainer({
      Image: options.image,
      Cmd: ['node', 'tool.js'],
      Env: [
        `TOOL_NAME=${toolName}`,
        `PARAMETERS=${JSON.stringify(parameters)}`
      ],
      HostConfig: {
        Memory: options.memory * 1024 * 1024,
        NetworkMode: 'none'  // ネットワークアクセスを禁止
      }
    });

    try {
      await container.start();

      // タイムアウト付きで待機
      const result = await Promise.race([
        this.waitForContainer(container),
        this.timeout(options.timeout)
      ]);

      return result;
    } finally {
      await container.remove({ force: true });
    }
  }

  private async waitForContainer(container: Docker.Container): Promise<any> {
    const stream = await container.logs({
      stdout: true,
      stderr: true,
      follow: true
    });

    return new Promise((resolve, reject) => {
      let output = '';
      stream.on('data', (chunk) => {
        output += chunk.toString();
      });
      stream.on('end', () => {
        try {
          resolve(JSON.parse(output));
        } catch (error) {
          reject(new Error('Invalid output from container'));
        }
      });
    });
  }

  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Execution timeout')), ms);
    });
  }
}
```

## 5. セキュリティヘッダー

### 5.1 概要

HTTPセキュリティヘッダーを設定し、一般的な攻撃を防ぎます。

### 5.2 実装設計

```typescript
// src/security/security-headers-plugin.ts

import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';

const securityHeadersPlugin: FastifyPluginAsync = async (fastify) => {
  // Helmetプラグインを登録
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:']
      }
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    },
    frameguard: {
      action: 'deny'
    },
    noSniff: true,
    xssFilter: true
  });

  // カスタムセキュリティヘッダー
  fastify.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  });
};

export default fp(securityHeadersPlugin);
```

## 6. 監査ログ

### 6.1 概要

すべてのAPIアクセスとツール実行を記録し、セキュリティ監査を可能にします。

### 6.2 実装設計

```typescript
// src/security/audit-logger.ts

export interface AuditLog {
  timestamp: Date;
  apiKey: string;
  action: string;
  resource: string;
  parameters?: Record<string, any>;
  result: 'success' | 'failure';
  error?: string;
  ip: string;
  userAgent?: string;
}

export class AuditLogger {
  private logs: AuditLog[] = [];

  /**
   * 監査ログを記録
   */
  log(entry: Omit<AuditLog, 'timestamp'>): void {
    this.logs.push({
      timestamp: new Date(),
      ...entry
    });

    // ファイルに書き込み（または外部サービスに送信）
    this.persist(entry);
  }

  /**
   * ログを永続化
   */
  private persist(entry: Omit<AuditLog, 'timestamp'>): void {
    // ファイルシステムまたはデータベースに保存
    // 実装は環境に応じて
  }

  /**
   * ログを検索
   */
  query(filter: {
    apiKey?: string;
    action?: string;
    startDate?: Date;
    endDate?: Date;
  }): AuditLog[] {
    return this.logs.filter(log => {
      if (filter.apiKey && log.apiKey !== filter.apiKey) return false;
      if (filter.action && log.action !== filter.action) return false;
      if (filter.startDate && log.timestamp < filter.startDate) return false;
      if (filter.endDate && log.timestamp > filter.endDate) return false;
      return true;
    });
  }
}

// Fastifyプラグイン
const auditLogPlugin: FastifyPluginAsync<{ auditLogger: AuditLogger }> = async (
  fastify,
  options
) => {
  const { auditLogger } = options;

  fastify.addHook('onResponse', async (request, reply) => {
    auditLogger.log({
      apiKey: request.apiKey?.key || 'anonymous',
      action: `${request.method} ${request.url}`,
      resource: request.url,
      parameters: request.body as any,
      result: reply.statusCode < 400 ? 'success' : 'failure',
      error: reply.statusCode >= 400 ? reply.statusCode.toString() : undefined,
      ip: request.ip,
      userAgent: request.headers['user-agent']
    });
  });
};
```

## 7. セキュリティ設定

### 7.1 環境変数

```bash
# .env.example

# 認証
API_KEY_REQUIRED=true
DEFAULT_API_KEY=mcp_your_default_key_here

# レート制限
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=60

# サンドボックス
SANDBOX_ENABLED=true
SANDBOX_TIMEOUT=30000
SANDBOX_MEMORY_MB=512

# セキュリティヘッダー
HSTS_ENABLED=true
CSP_ENABLED=true

# 監査ログ
AUDIT_LOG_ENABLED=true
AUDIT_LOG_PATH=./logs/audit.log
```

## 8. 実装優先順位

### Phase 3: 基本セキュリティ
- [ ] APIキー認証の実装
- [ ] レート制限の実装
- [ ] JSONスキーマバリデーション
- [ ] セキュリティヘッダーの設定
- [ ] 監査ログの実装

### Phase 4: 高度なセキュリティ
- [ ] 権限ベースのアクセス制御
- [ ] カスタムバリデーター
- [ ] サンドボックス実行（VM2）

### Phase 5: エンタープライズセキュリティ
- [ ] Docker コンテナ実行
- [ ] OAuth2.0サポート
- [ ] 多要素認証

## 次のステップ

1. APIキー認証の実装
2. レート制限プラグインの実装
3. バリデーションスキーマの定義
4. セキュリティヘッダープラグインの実装
5. 監査ログの実装
6. テストの作成

[次へ: ツール管理機能設計](./04-tool-management.md)
