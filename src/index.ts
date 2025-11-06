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
import { HealthChecker } from './monitoring/health-check.js';
import type {
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCError,
} from './types/mcp.js';

// Initialize MCP Client Manager
const manager = new MCPClientManager();

// Initialize Health Checker
const healthChecker = new HealthChecker(manager, '1.0.0');

// Search tools metadata (registered after initialization)
const searchTools = [
  createSearchToolMetadata(),
  createAdvancedSearchToolMetadata(),
  createListServersToolMetadata(),
  createHealthCheckToolMetadata(),
];

// Track request ID for responses
let initialized = false;

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
        } catch (error) {
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

        // Add search tools to the list
        const allTools = [
          ...searchTools.map(tool => ({
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

        // Check if this is a search tool
        if (name === 'search_tools') {
          const impl = createSearchToolImplementation(() => manager.listAllToolsFull());
          const result = await impl(args || {});
          sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
          break;
        }

        if (name === 'advanced_search') {
          const impl = createAdvancedSearchToolImplementation(() => manager.listAllToolsFull());
          const result = await impl(args || {});
          sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
          break;
        }

        if (name === 'list_servers') {
          const impl = createListServersToolImplementation(() => manager.getStats());
          const result = await impl(args || {});
          sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
          break;
        }

        if (name === 'health_check') {
          const impl = createHealthCheckToolImplementation(healthChecker);
          const result = await impl(args || {});
          sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
          break;
        }

        // Execute the tool on the appropriate backend MCP server
        const result = await manager.executeTool(name, args || {});

        sendResponse(id, result);
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
    await manager.stopAll();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.error('Received SIGTERM, shutting down...');
    await manager.stopAll();
    process.exit(0);
  });

  console.error('Search MCP Server ready for requests');
}

// Start the server
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
