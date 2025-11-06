/**
 * Search MCP Server - MCP Aggregator
 *
 * Aggregates multiple MCP servers and reduces AI client context consumption by 70-80%
 */

import { createInterface } from 'readline';
import { MCPClientManager } from './mcp/mcp-client-manager.js';
import {
  MCPError,
  isMCPError,
  toMCPError,
  ConfigurationError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
} from './errors.js';
import {
  createSearchToolMetadata,
  createSearchToolImplementation,
  createAdvancedSearchToolMetadata,
  createAdvancedSearchToolImplementation,
  createListServersToolMetadata,
  createListServersToolImplementation,
  createHealthCheckToolMetadata,
  createHealthCheckToolImplementation,
} from './search/search-tools.js';
import {
  createAuditLogsToolMetadata,
  createAuditLogsToolImplementation,
  createAuditStatsToolMetadata,
  createAuditStatsToolImplementation,
  createParallelExecutionToolMetadata,
  createParallelExecutionToolImplementation,
  createRateLimitStatsToolMetadata,
  createRateLimitStatsToolImplementation,
  createCacheStatsToolMetadata,
  createCacheStatsToolImplementation,
} from './tools/phase3-tools.js';
import { HealthChecker } from './monitoring/health-check.js';
import { getAuthManager, initializeAuthManager, type AuthContext } from './security/auth-manager.js';
import { getRateLimiter } from './security/rate-limiter.js';
import { getParallelExecutor } from './performance/parallel-executor.js';
import { getAuditLogger } from './monitoring/audit-logger.js';
import { getToolCache } from './performance/tool-cache.js';
import type {
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCError,
} from './types/mcp.js';

// Initialize MCP Client Manager
const manager = new MCPClientManager();

// Initialize Health Checker
const healthChecker = new HealthChecker(manager, '1.0.0');

// Initialize Auth Manager
const authEnabled = process.env.AUTH_ENABLED === 'true';
const authManager = getAuthManager();

// Initialize Rate Limiter
const rateLimiter = getRateLimiter();

// Initialize Parallel Executor (will be initialized after manager is ready)
let parallelExecutor: ReturnType<typeof getParallelExecutor> | null = null;

// Initialize Audit Logger
const auditLogger = getAuditLogger();

// Search tools metadata (registered after initialization)
const searchTools = [
  createSearchToolMetadata(),
  createAdvancedSearchToolMetadata(),
  createListServersToolMetadata(),
  createHealthCheckToolMetadata(),
];

// Phase 3 tools metadata
const phase3Tools = [
  createAuditLogsToolMetadata(),
  createAuditStatsToolMetadata(),
  createParallelExecutionToolMetadata(),
  createRateLimitStatsToolMetadata(),
  createCacheStatsToolMetadata(),
];

// All internal tools
const allInternalTools = [...searchTools, ...phase3Tools];

// Track request ID for responses
let initialized = false;

// Current authentication context (for stdio, we use anonymous by default)
let currentAuthContext: AuthContext = {
  apiKeyId: 'anonymous',
  permissions: ['*'],
  authenticated: false,
};

/**
 * Send a JSON-RPC response to stdout
 */
function sendResponse(id: number | string, result?: any, error?: JSONRPCError): void {
  const response: JSONRPCResponse = {
    jsonrpc: '2.0',
    id,
  };

  if (error) {
    response.error = error;
  } else {
    response.result = result;
  }

  console.log(JSON.stringify(response));
}

/**
 * Send a JSON-RPC error response
 */
function sendError(id: number | string, code: number, message: string, data?: any): void {
  sendResponse(id, undefined, { code, message, data });
}

/**
 * Handle JSON-RPC request
 */
async function handleRequest(request: JSONRPCRequest): Promise<void> {
  const { id, method, params } = request;

  try {
    switch (method) {
      case 'initialize': {
        // Initialize the Search MCP server
        const configPath = process.env.MCP_CONFIG_PATH || './config/mcp-servers.json';

        try {
          await manager.loadConfig(configPath);
          await manager.startAll();

          // Initialize parallel executor after manager is ready
          parallelExecutor = getParallelExecutor(manager);

          // Initialize auth manager if enabled
          if (authEnabled) {
            const keysFilePath = process.env.AUTH_KEYS_FILE || './config/api-keys.json';
            await initializeAuthManager(true, keysFilePath);
            authManager.setAuthEnabled(true);
            console.error('Authentication enabled');
          }

          // Log system initialization
          await auditLogger.log({
            type: 'system',
            level: 'info',
            actor: { id: 'system', type: 'system' },
            action: 'initialize',
            result: 'success',
            details: {
              configPath,
              authEnabled,
              servers: manager.getStats().totalServers,
            },
          });
        } catch (error) {
          await auditLogger.log({
            type: 'system',
            level: 'error',
            actor: { id: 'system', type: 'system' },
            action: 'initialize',
            result: 'failure',
            error: {
              message: error instanceof Error ? error.message : 'Unknown error',
              code: 'INITIALIZATION_ERROR',
            },
          });

          throw new ConfigurationError(
            `Failed to initialize MCP servers: ${error instanceof Error ? error.message : 'Unknown error'}`,
            configPath
          );
        }

        initialized = true;

        sendResponse(id, {
          protocolVersion: '1.0.0',
          serverInfo: {
            name: 'search-mcp',
            version: '1.0.0',
          },
          capabilities: {
            tools: {},
          },
        });
        break;
      }

      case 'tools/list': {
        if (!initialized) {
          sendError(id, -32002, 'Server not initialized');
          return;
        }

        // Return lightweight tool metadata (no inputSchema for context reduction)
        const aggregatedTools = manager.listAllTools();

        // Add internal tools to the list
        const allTools = [
          ...allInternalTools.map(tool => ({
            name: tool.name,
            description: tool.description,
          })),
          ...aggregatedTools,
        ];

        sendResponse(id, {
          tools: allTools,
        });
        break;
      }

      case 'tools/call': {
        if (!initialized) {
          sendError(id, -32002, 'Server not initialized');
          return;
        }

        const { name, arguments: args } = params;

        if (!name) {
          throw new ValidationError('Tool name is required', 'name');
        }

        const startTime = Date.now();

        try {
          // Check rate limit
          const tier = currentAuthContext.authenticated ? 'authenticated' : 'default';
          const rateLimit = rateLimiter.checkLimit(currentAuthContext.apiKeyId, tier);

          if (!rateLimit.allowed) {
            await auditLogger.logRateLimit(
              currentAuthContext.apiKeyId,
              rateLimit.remaining,
              rateLimit.resetAt
            );
            throw new Error(`Rate limit exceeded. Retry after ${rateLimit.retryAfter} seconds.`);
          }

          // Check permission (if auth is enabled)
          if (authEnabled) {
            authManager.requirePermission(currentAuthContext, `tools:${name}`);
          }

          let result: any;

          // Check if this is a search tool
          if (name === 'search_tools') {
            const impl = createSearchToolImplementation(() => manager.listAllToolsFull());
            result = await impl(args || {});
            sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
          } else if (name === 'advanced_search') {
            const impl = createAdvancedSearchToolImplementation(() => manager.listAllToolsFull());
            result = await impl(args || {});
            sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
          } else if (name === 'list_servers') {
            const impl = createListServersToolImplementation(() => manager.getStats());
            result = await impl(args || {});
            sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
          } else if (name === 'health_check') {
            const impl = createHealthCheckToolImplementation(healthChecker);
            result = await impl(args || {});
            sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
          } else if (name === 'query_audit_logs') {
            const impl = createAuditLogsToolImplementation(auditLogger);
            result = await impl(args || {});
            sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
          } else if (name === 'get_audit_stats') {
            const impl = createAuditStatsToolImplementation(auditLogger);
            result = await impl(args || {});
            sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
          } else if (name === 'execute_parallel') {
            if (!parallelExecutor) {
              throw new Error('Parallel executor not initialized');
            }
            const impl = createParallelExecutionToolImplementation(parallelExecutor);
            result = await impl(args || {});
            sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
          } else if (name === 'get_rate_limit_stats') {
            const impl = createRateLimitStatsToolImplementation(rateLimiter);
            result = await impl(args || {});
            sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
          } else if (name === 'get_cache_stats') {
            const toolCache = getToolCache();
            const impl = createCacheStatsToolImplementation(() => toolCache.getStats());
            result = await impl(args || {});
            sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
          } else {
            // Execute the tool on the appropriate backend MCP server
            result = await manager.executeTool(name, args || {});
            sendResponse(id, result);
          }

          // Log successful execution
          const duration = Date.now() - startTime;
          await auditLogger.logToolExecution(
            currentAuthContext.apiKeyId,
            name,
            args || {},
            'success',
            duration
          );
        } catch (error) {
          // Log failed execution
          const duration = Date.now() - startTime;
          await auditLogger.logToolExecution(
            currentAuthContext.apiKeyId,
            name,
            args || {},
            'failure',
            duration,
            error instanceof Error ? error : new Error(String(error))
          );
          throw error;
        }

        break;
      }

      case 'ping': {
        // Health check endpoint
        sendResponse(id, { status: 'ok' });
        break;
      }

      default: {
        sendError(id, -32601, `Method not found: ${method}`);
      }
    }
  } catch (error) {
    // Convert to MCPError for consistent error handling
    const mcpError = isMCPError(error) ? error : toMCPError(error);

    // Map MCPError to JSON-RPC error code
    let jsonRpcCode = -32000; // Server error
    if (mcpError.statusCode === 400) {
      jsonRpcCode = -32602; // Invalid params
    } else if (mcpError.statusCode === 404) {
      jsonRpcCode = -32601; // Method not found
    }

    sendError(id, jsonRpcCode, mcpError.message, {
      code: mcpError.code,
      details: mcpError.details,
    });
  }
}

/**
 * Main entry point
 */
async function main() {
  console.error('Search MCP Server starting...');

  // Setup readline for stdin
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  // Handle each line as a JSON-RPC request
  rl.on('line', async (line) => {
    try {
      const request: JSONRPCRequest = JSON.parse(line);
      await handleRequest(request);
    } catch (error) {
      console.error('Failed to parse request:', line, error);
      // Send parse error for invalid JSON
      sendError(0, -32700, 'Parse error');
    }
  });

  // Handle process termination
  process.on('SIGINT', async () => {
    console.error('Received SIGINT, shutting down...');

    // Log shutdown
    await auditLogger.log({
      type: 'system',
      level: 'info',
      actor: { id: 'system', type: 'system' },
      action: 'shutdown',
      result: 'success',
      details: { signal: 'SIGINT' },
    });

    // Stop services
    await manager.stopAll();
    rateLimiter.stop();

    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.error('Received SIGTERM, shutting down...');

    // Log shutdown
    await auditLogger.log({
      type: 'system',
      level: 'info',
      actor: { id: 'system', type: 'system' },
      action: 'shutdown',
      result: 'success',
      details: { signal: 'SIGTERM' },
    });

    // Stop services
    await manager.stopAll();
    rateLimiter.stop();

    process.exit(0);
  });

  console.error('Search MCP Server ready for requests');
}

// Start the server
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
