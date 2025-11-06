/**
 * Health Check - Monitor system health and status
 */

import type { MCPClientManager } from '../mcp/mcp-client-manager.js';
import { getToolCache } from '../performance/tool-cache.js';
import { getConfigManager } from '../config/config-manager.js';

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
      details?: any;
    };
  };
}

export class HealthChecker {
  private startTime: number;
  private version: string;

  constructor(
    private manager: MCPClientManager,
    version: string = '1.0.0'
  ) {
    this.startTime = Date.now();
    this.version = version;
  }

  /**
   * Perform a comprehensive health check
   */
  async check(): Promise<HealthStatus> {
    const checks: HealthStatus['checks'] = {};

    // Memory check
    checks.memory = await this.checkMemory();

    // MCP servers check
    checks.mcpServers = await this.checkMCPServers();

    // Cache check
    checks.cache = await this.checkCache();

    // Configuration check
    checks.configuration = await this.checkConfiguration();

    // Determine overall status
    const status = this.determineOverallStatus(checks);

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      version: this.version,
      checks,
    };
  }

  /**
   * Quick health check (less expensive)
   */
  async quickCheck(): Promise<Pick<HealthStatus, 'status' | 'timestamp' | 'uptime'>> {
    const stats = this.manager.getStats();

    const status = stats.runningServers > 0 ? 'healthy' : 'unhealthy';

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
    };
  }

  /**
   * Check memory usage
   */
  private async checkMemory(): Promise<HealthStatus['checks']['memory']> {
    const startTime = Date.now();

    try {
      const usage = process.memoryUsage();
      const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
      const usagePercent = (heapUsedMB / heapTotalMB) * 100;

      let status: 'pass' | 'fail' | 'warn' = 'pass';
      let message = `Memory usage: ${heapUsedMB}MB / ${heapTotalMB}MB (${usagePercent.toFixed(1)}%)`;

      if (usagePercent > 90) {
        status = 'fail';
        message = `Critical memory usage: ${usagePercent.toFixed(1)}%`;
      } else if (usagePercent > 80) {
        status = 'warn';
        message = `High memory usage: ${usagePercent.toFixed(1)}%`;
      }

      return {
        status,
        message,
        responseTime: Date.now() - startTime,
        details: {
          heapUsedMB,
          heapTotalMB,
          usagePercent: parseFloat(usagePercent.toFixed(2)),
          rss: Math.round(usage.rss / 1024 / 1024),
          external: Math.round(usage.external / 1024 / 1024),
        },
      };
    } catch (error) {
      return {
        status: 'fail',
        message: `Memory check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        responseTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Check MCP servers status
   */
  private async checkMCPServers(): Promise<HealthStatus['checks']['mcpServers']> {
    const startTime = Date.now();

    try {
      const stats = this.manager.getStats();

      let status: 'pass' | 'fail' | 'warn' = 'pass';
      let message = `${stats.runningServers}/${stats.totalServers} servers running, ${stats.totalTools} tools available`;

      if (stats.runningServers === 0) {
        status = 'fail';
        message = 'No MCP servers running';
      } else if (stats.runningServers < stats.totalServers) {
        status = 'warn';
        message = `Only ${stats.runningServers}/${stats.totalServers} servers running`;
      }

      return {
        status,
        message,
        responseTime: Date.now() - startTime,
        details: {
          totalServers: stats.totalServers,
          runningServers: stats.runningServers,
          totalTools: stats.totalTools,
          servers: stats.servers,
        },
      };
    } catch (error) {
      return {
        status: 'fail',
        message: `MCP servers check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        responseTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Check cache status
   */
  private async checkCache(): Promise<HealthStatus['checks']['cache']> {
    const startTime = Date.now();

    try {
      const toolCache = getToolCache();
      const stats = toolCache.getStats();

      let status: 'pass' | 'fail' | 'warn' = 'pass';
      let message = `Cache: ${stats.size} entries, hit rate: ${(stats.hitRate * 100).toFixed(1)}%`;

      if (stats.size >= stats.maxSize * 0.9) {
        status = 'warn';
        message = `Cache almost full: ${stats.size}/${stats.maxSize} entries`;
      }

      return {
        status,
        message,
        responseTime: Date.now() - startTime,
        details: stats,
      };
    } catch (error) {
      return {
        status: 'warn',
        message: `Cache check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        responseTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Check configuration
   */
  private async checkConfiguration(): Promise<HealthStatus['checks']['configuration']> {
    const startTime = Date.now();

    try {
      const configManager = getConfigManager();
      const summary = configManager.getSummary();

      const status: 'pass' | 'fail' | 'warn' = 'pass';
      const message = `Configuration: ${summary.totalTools} tools configured, ${summary.enabledTools} enabled`;

      return {
        status,
        message,
        responseTime: Date.now() - startTime,
        details: summary,
      };
    } catch (error) {
      return {
        status: 'warn',
        message: `Configuration check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        responseTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Determine overall health status
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

  /**
   * Get uptime in human-readable format
   */
  getUptimeString(): string {
    const uptime = Date.now() - this.startTime;
    const seconds = Math.floor(uptime / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}
