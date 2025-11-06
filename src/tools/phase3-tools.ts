/**
 * Phase 3 Tools - Security and performance management tools
 */

import type { ToolMetadata, ToolImplementation } from '../types.js';
import type { AuditLogger } from '../monitoring/audit-logger.js';
import type { TieredRateLimiter } from '../security/rate-limiter.js';
import type { ParallelExecutor, ParallelExecutionRequest } from '../performance/parallel-executor.js';

/**
 * Create audit logs query tool metadata
 */
export function createAuditLogsToolMetadata(): ToolMetadata {
  return {
    name: 'query_audit_logs',
    description: 'Query audit logs with filters for security and compliance monitoring',
    parameters: [
      {
        name: 'startDate',
        type: 'string',
        description: 'Start date for log query (ISO 8601 format)',
        required: false,
      },
      {
        name: 'endDate',
        type: 'string',
        description: 'End date for log query (ISO 8601 format)',
        required: false,
      },
      {
        name: 'type',
        type: 'string',
        description: 'Event type filter',
        required: false,
        enum: ['tool_execution', 'authentication', 'authorization', 'configuration_change', 'rate_limit', 'error', 'system'],
      },
      {
        name: 'level',
        type: 'string',
        description: 'Event level filter',
        required: false,
        enum: ['info', 'warn', 'error', 'critical'],
      },
      {
        name: 'actorId',
        type: 'string',
        description: 'Filter by actor ID',
        required: false,
      },
      {
        name: 'action',
        type: 'string',
        description: 'Filter by action',
        required: false,
      },
      {
        name: 'result',
        type: 'string',
        description: 'Filter by result',
        required: false,
        enum: ['success', 'failure'],
      },
      {
        name: 'limit',
        type: 'number',
        description: 'Maximum number of results',
        required: false,
        minimum: 1,
        maximum: 1000,
        default: 100,
      },
      {
        name: 'offset',
        type: 'number',
        description: 'Pagination offset',
        required: false,
        minimum: 0,
        default: 0,
      },
    ],
  };
}

/**
 * Create audit logs query tool implementation
 */
export function createAuditLogsToolImplementation(
  auditLogger: AuditLogger
): ToolImplementation {
  return async (parameters: Record<string, any>) => {
    const query: any = {
      limit: parameters.limit || 100,
      offset: parameters.offset || 0,
    };

    if (parameters.startDate) {
      query.startDate = new Date(parameters.startDate);
    }
    if (parameters.endDate) {
      query.endDate = new Date(parameters.endDate);
    }
    if (parameters.type) {
      query.type = parameters.type;
    }
    if (parameters.level) {
      query.level = parameters.level;
    }
    if (parameters.actorId) {
      query.actorId = parameters.actorId;
    }
    if (parameters.action) {
      query.action = parameters.action;
    }
    if (parameters.result) {
      query.result = parameters.result;
    }

    const logs = auditLogger.query(query);
    const stats = auditLogger.getStats();

    return {
      logs,
      stats,
      query,
    };
  };
}

/**
 * Create audit stats tool metadata
 */
export function createAuditStatsToolMetadata(): ToolMetadata {
  return {
    name: 'get_audit_stats',
    description: 'Get statistical summary of audit logs',
    parameters: [
      {
        name: 'timeWindowMs',
        type: 'number',
        description: 'Time window in milliseconds (optional, defaults to all time)',
        required: false,
        minimum: 1000,
      },
    ],
  };
}

/**
 * Create audit stats tool implementation
 */
export function createAuditStatsToolImplementation(
  auditLogger: AuditLogger
): ToolImplementation {
  return async (parameters: Record<string, any>) => {
    const timeWindowMs = parameters.timeWindowMs;
    const stats = auditLogger.getStats(timeWindowMs);

    return {
      stats,
      timeWindow: timeWindowMs ? `Last ${timeWindowMs}ms` : 'All time',
    };
  };
}

/**
 * Create parallel execution tool metadata
 */
export function createParallelExecutionToolMetadata(): ToolMetadata {
  return {
    name: 'execute_parallel',
    description: 'Execute multiple tool calls in parallel for improved performance',
    parameters: [
      {
        name: 'requests',
        type: 'array',
        description: 'Array of tool execution requests, each with toolName and parameters',
        required: true,
      },
      {
        name: 'maxConcurrency',
        type: 'number',
        description: 'Maximum number of concurrent executions',
        required: false,
        minimum: 1,
        maximum: 50,
        default: 10,
      },
      {
        name: 'timeout',
        type: 'number',
        description: 'Timeout in milliseconds for each execution',
        required: false,
        minimum: 1000,
        default: 30000,
      },
      {
        name: 'continueOnError',
        type: 'boolean',
        description: 'Continue executing remaining tasks if one fails',
        required: false,
        default: true,
      },
    ],
  };
}

/**
 * Create parallel execution tool implementation
 */
export function createParallelExecutionToolImplementation(
  parallelExecutor: ParallelExecutor
): ToolImplementation {
  return async (parameters: Record<string, any>) => {
    const { requests, maxConcurrency, timeout, continueOnError } = parameters;

    if (!Array.isArray(requests)) {
      throw new Error('requests parameter must be an array');
    }

    const parallelRequests: ParallelExecutionRequest[] = requests.map((req: any, index: number) => ({
      id: req.id || `request-${index}`,
      toolName: req.toolName,
      parameters: req.parameters || {},
    }));

    const summary = await parallelExecutor.executeParallel(parallelRequests, {
      maxConcurrency,
      timeout,
      continueOnError,
    });

    const stats = parallelExecutor.getExecutionStats(summary);

    return {
      summary,
      stats,
    };
  };
}

/**
 * Create rate limit stats tool metadata
 */
export function createRateLimitStatsToolMetadata(): ToolMetadata {
  return {
    name: 'get_rate_limit_stats',
    description: 'Get current rate limit statistics for all identifiers',
    parameters: [],
  };
}

/**
 * Create rate limit stats tool implementation
 */
export function createRateLimitStatsToolImplementation(
  rateLimiter: TieredRateLimiter
): ToolImplementation {
  return async () => {
    const stats = rateLimiter.getStats();
    return stats;
  };
}

/**
 * Create cache stats tool metadata
 */
export function createCacheStatsToolMetadata(): ToolMetadata {
  return {
    name: 'get_cache_stats',
    description: 'Get cache performance statistics',
    parameters: [],
  };
}

/**
 * Create cache stats tool implementation
 */
export function createCacheStatsToolImplementation(
  getCacheStats: () => any
): ToolImplementation {
  return async () => {
    return getCacheStats();
  };
}
