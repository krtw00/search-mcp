/**
 * Authentication Manager - API key-based authentication for MCP tools
 */

import { createHash, randomBytes } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { AuthenticationError, AuthorizationError } from '../errors.js';

export interface ApiKey {
  id: string;
  key: string;
  hashedKey: string;
  name: string;
  permissions: string[];
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  enabled: boolean;
}

export interface AuthContext {
  apiKeyId: string;
  permissions: string[];
  authenticated: boolean;
}

export class AuthManager {
  private apiKeys: Map<string, ApiKey>;
  private authEnabled: boolean;

  constructor(authEnabled: boolean = false) {
    this.apiKeys = new Map();
    this.authEnabled = authEnabled;
  }

  /**
   * Generate a new API key
   */
  generateApiKey(name: string, permissions: string[] = [], expiresIn?: number): ApiKey {
    const keyId = this.generateId();
    const apiKey = this.generateSecureKey();
    const hashedKey = this.hashKey(apiKey);

    const key: ApiKey = {
      id: keyId,
      key: apiKey, // Only returned once during generation
      hashedKey,
      name,
      permissions,
      createdAt: new Date().toISOString(),
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn).toISOString() : undefined,
      enabled: true,
    };

    this.apiKeys.set(keyId, key);

    return key;
  }

  /**
   * Validate an API key
   */
  async validateApiKey(apiKey: string): Promise<AuthContext> {
    if (!this.authEnabled) {
      // Authentication disabled, allow all
      return {
        apiKeyId: 'anonymous',
        permissions: ['*'],
        authenticated: false,
      };
    }

    if (!apiKey) {
      throw new AuthenticationError('API key is required');
    }

    const hashedKey = this.hashKey(apiKey);

    // Find matching API key
    for (const [id, key] of this.apiKeys.entries()) {
      if (key.hashedKey === hashedKey) {
        // Check if enabled
        if (!key.enabled) {
          throw new AuthenticationError('API key is disabled');
        }

        // Check expiration
        if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
          throw new AuthenticationError('API key has expired');
        }

        // Update last used
        key.lastUsedAt = new Date().toISOString();

        return {
          apiKeyId: id,
          permissions: key.permissions,
          authenticated: true,
        };
      }
    }

    throw new AuthenticationError('Invalid API key');
  }

  /**
   * Check if user has permission
   */
  hasPermission(authContext: AuthContext, permission: string): boolean {
    if (!this.authEnabled) {
      return true;
    }

    // Wildcard permission
    if (authContext.permissions.includes('*')) {
      return true;
    }

    // Exact match
    if (authContext.permissions.includes(permission)) {
      return true;
    }

    // Pattern match (e.g., "tools:*" matches "tools:search")
    for (const perm of authContext.permissions) {
      if (perm.endsWith(':*')) {
        const prefix = perm.slice(0, -1); // Remove '*'
        if (permission.startsWith(prefix)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Require permission (throws if not authorized)
   */
  requirePermission(authContext: AuthContext, permission: string): void {
    if (!this.hasPermission(authContext, permission)) {
      throw new AuthorizationError(
        `Permission denied: ${permission}`,
        permission
      );
    }
  }

  /**
   * Revoke an API key
   */
  revokeApiKey(keyId: string): boolean {
    const key = this.apiKeys.get(keyId);
    if (key) {
      key.enabled = false;
      return true;
    }
    return false;
  }

  /**
   * Delete an API key
   */
  deleteApiKey(keyId: string): boolean {
    return this.apiKeys.delete(keyId);
  }

  /**
   * List all API keys (without the actual key)
   */
  listApiKeys(): Omit<ApiKey, 'key' | 'hashedKey'>[] {
    return Array.from(this.apiKeys.values()).map(key => ({
      id: key.id,
      name: key.name,
      permissions: key.permissions,
      createdAt: key.createdAt,
      expiresAt: key.expiresAt,
      lastUsedAt: key.lastUsedAt,
      enabled: key.enabled,
    }));
  }

  /**
   * Load API keys from file
   */
  async loadFromFile(filePath: string): Promise<void> {
    if (!existsSync(filePath)) {
      return;
    }

    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    if (data.authEnabled !== undefined) {
      this.authEnabled = data.authEnabled;
    }

    if (data.apiKeys && Array.isArray(data.apiKeys)) {
      for (const key of data.apiKeys) {
        // Don't include the plaintext key when loading
        const apiKey: ApiKey = {
          ...key,
          key: '', // Never store plaintext key
        };
        this.apiKeys.set(key.id, apiKey);
      }
    }

    console.error(`Loaded ${this.apiKeys.size} API keys from ${filePath}`);
  }

  /**
   * Save API keys to file
   */
  async saveToFile(filePath: string): Promise<void> {
    const data = {
      authEnabled: this.authEnabled,
      apiKeys: Array.from(this.apiKeys.values()).map(key => ({
        id: key.id,
        hashedKey: key.hashedKey,
        name: key.name,
        permissions: key.permissions,
        createdAt: key.createdAt,
        expiresAt: key.expiresAt,
        lastUsedAt: key.lastUsedAt,
        enabled: key.enabled,
        // Never save plaintext key
      })),
    };

    await writeFile(filePath, JSON.stringify(data, null, 2));
    console.error(`Saved ${this.apiKeys.size} API keys to ${filePath}`);
  }

  /**
   * Generate a secure random key
   */
  private generateSecureKey(): string {
    const prefix = 'smcp'; // Search MCP prefix
    const random = randomBytes(32).toString('base64url');
    return `${prefix}_${random}`;
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return randomBytes(16).toString('hex');
  }

  /**
   * Hash an API key
   */
  private hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  /**
   * Enable or disable authentication
   */
  setAuthEnabled(enabled: boolean): void {
    this.authEnabled = enabled;
  }

  /**
   * Check if authentication is enabled
   */
  isAuthEnabled(): boolean {
    return this.authEnabled;
  }

  /**
   * Get API key by ID
   */
  getApiKey(keyId: string): Omit<ApiKey, 'key' | 'hashedKey'> | undefined {
    const key = this.apiKeys.get(keyId);
    if (!key) {
      return undefined;
    }

    return {
      id: key.id,
      name: key.name,
      permissions: key.permissions,
      createdAt: key.createdAt,
      expiresAt: key.expiresAt,
      lastUsedAt: key.lastUsedAt,
      enabled: key.enabled,
    };
  }
}

// Global singleton instance
let globalAuthManager: AuthManager | null = null;

/**
 * Get the global authentication manager instance
 */
export function getAuthManager(): AuthManager {
  if (!globalAuthManager) {
    globalAuthManager = new AuthManager(false); // Disabled by default
  }
  return globalAuthManager;
}

/**
 * Initialize the global authentication manager
 */
export async function initializeAuthManager(
  authEnabled: boolean,
  keysFilePath?: string
): Promise<AuthManager> {
  const manager = new AuthManager(authEnabled);

  if (keysFilePath && existsSync(keysFilePath)) {
    await manager.loadFromFile(keysFilePath);
  }

  globalAuthManager = manager;
  return manager;
}
