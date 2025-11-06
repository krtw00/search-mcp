/**
 * Configuration Manager - Manages tool-specific and global configurations
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { ConfigurationError } from '../errors.js';

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

export interface GlobalConfig {
  defaultTimeout: number;
  defaultMaxRetries: number;
  defaultCacheTTL: number;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  tools?: Record<string, Partial<ToolConfig>>;
}

export class ConfigManager {
  private toolConfigs: Map<string, ToolConfig>;
  private globalConfig: GlobalConfig;
  private defaultToolConfig: ToolConfig = {
    enabled: true,
    timeout: 30000,  // 30 seconds
    maxRetries: 0,
    cache: {
      enabled: false,
      ttl: 300,  // 5 minutes
    },
  };

  constructor(globalConfig?: Partial<GlobalConfig>) {
    this.toolConfigs = new Map();
    this.globalConfig = {
      defaultTimeout: 30000,
      defaultMaxRetries: 0,
      defaultCacheTTL: 300,
      logLevel: 'info',
      ...globalConfig,
    };
  }

  /**
   * Set configuration for a specific tool
   */
  setToolConfig(toolName: string, config: Partial<ToolConfig>): void {
    const existing = this.toolConfigs.get(toolName) || { ...this.defaultToolConfig };

    // Merge configurations
    const merged: ToolConfig = {
      ...existing,
      ...config,
      cache: config.cache
        ? { ...existing.cache, ...config.cache }
        : existing.cache,
    };

    this.toolConfigs.set(toolName, merged);
  }

  /**
   * Get configuration for a specific tool
   */
  getToolConfig(toolName: string): ToolConfig {
    const config = this.toolConfigs.get(toolName);

    if (config) {
      return { ...config };
    }

    // Return default config with global defaults
    return {
      ...this.defaultToolConfig,
      timeout: this.globalConfig.defaultTimeout,
      maxRetries: this.globalConfig.defaultMaxRetries,
      cache: {
        enabled: false,
        ttl: this.globalConfig.defaultCacheTTL,
      },
    };
  }

  /**
   * Get all tool configurations
   */
  getAllToolConfigs(): Map<string, ToolConfig> {
    return new Map(this.toolConfigs);
  }

  /**
   * Enable a tool
   */
  enableTool(toolName: string): void {
    const config = this.getToolConfig(toolName);
    config.enabled = true;
    this.toolConfigs.set(toolName, config);
  }

  /**
   * Disable a tool
   */
  disableTool(toolName: string): void {
    const config = this.getToolConfig(toolName);
    config.enabled = false;
    this.toolConfigs.set(toolName, config);
  }

  /**
   * Check if a tool is enabled
   */
  isToolEnabled(toolName: string): boolean {
    const config = this.getToolConfig(toolName);
    return config.enabled;
  }

  /**
   * Set global configuration
   */
  setGlobalConfig(config: Partial<GlobalConfig>): void {
    this.globalConfig = {
      ...this.globalConfig,
      ...config,
    };

    // Update default tool config with new global defaults
    this.defaultToolConfig = {
      ...this.defaultToolConfig,
      timeout: this.globalConfig.defaultTimeout,
      maxRetries: this.globalConfig.defaultMaxRetries,
    };
  }

  /**
   * Get global configuration
   */
  getGlobalConfig(): GlobalConfig {
    return { ...this.globalConfig };
  }

  /**
   * Load configuration from a file
   */
  async loadFromFile(filePath: string): Promise<void> {
    if (!existsSync(filePath)) {
      throw new ConfigurationError(
        `Configuration file not found: ${filePath}`,
        filePath
      );
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      const config = JSON.parse(content);

      // Load global config
      if (config.global) {
        this.setGlobalConfig(config.global);
      }

      // Load tool-specific configs
      if (config.tools) {
        for (const [toolName, toolConfig] of Object.entries(config.tools)) {
          this.setToolConfig(toolName, toolConfig as Partial<ToolConfig>);
        }
      }

      console.error(`Loaded configuration from ${filePath}`);
    } catch (error) {
      throw new ConfigurationError(
        `Failed to load configuration: ${error instanceof Error ? error.message : 'Unknown error'}`,
        filePath
      );
    }
  }

  /**
   * Save configuration to a file
   */
  async saveToFile(filePath: string): Promise<void> {
    try {
      const config = {
        global: this.globalConfig,
        tools: Object.fromEntries(this.toolConfigs),
      };

      await writeFile(filePath, JSON.stringify(config, null, 2));
      console.error(`Saved configuration to ${filePath}`);
    } catch (error) {
      throw new ConfigurationError(
        `Failed to save configuration: ${error instanceof Error ? error.message : 'Unknown error'}`,
        filePath
      );
    }
  }

  /**
   * Reset all configurations to default
   */
  reset(): void {
    this.toolConfigs.clear();
    this.globalConfig = {
      defaultTimeout: 30000,
      defaultMaxRetries: 0,
      defaultCacheTTL: 300,
      logLevel: 'info',
    };
  }

  /**
   * Get configuration summary
   */
  getSummary(): {
    totalTools: number;
    enabledTools: number;
    disabledTools: number;
    globalConfig: GlobalConfig;
  } {
    const allConfigs = Array.from(this.toolConfigs.values());

    return {
      totalTools: allConfigs.length,
      enabledTools: allConfigs.filter(c => c.enabled).length,
      disabledTools: allConfigs.filter(c => !c.enabled).length,
      globalConfig: this.getGlobalConfig(),
    };
  }

  /**
   * Validate tool configuration
   */
  validateToolConfig(config: Partial<ToolConfig>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (config.timeout !== undefined) {
      if (typeof config.timeout !== 'number' || config.timeout <= 0) {
        errors.push('Timeout must be a positive number');
      }
    }

    if (config.maxRetries !== undefined) {
      if (typeof config.maxRetries !== 'number' || config.maxRetries < 0) {
        errors.push('Max retries must be a non-negative number');
      }
    }

    if (config.cache) {
      if (config.cache.ttl !== undefined) {
        if (typeof config.cache.ttl !== 'number' || config.cache.ttl <= 0) {
          errors.push('Cache TTL must be a positive number');
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

// Global singleton instance
let globalConfigManager: ConfigManager | null = null;

/**
 * Get the global configuration manager instance
 */
export function getConfigManager(): ConfigManager {
  if (!globalConfigManager) {
    globalConfigManager = new ConfigManager();
  }
  return globalConfigManager;
}

/**
 * Initialize the global configuration manager with a config file
 */
export async function initializeConfigManager(configPath?: string): Promise<ConfigManager> {
  const manager = getConfigManager();

  if (configPath && existsSync(configPath)) {
    await manager.loadFromFile(configPath);
  }

  return manager;
}
