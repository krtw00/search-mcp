/**
 * Search MCP Server - MCP Aggregator
 *
 * Aggregates multiple MCP servers and reduces AI client context consumption by 70-80%
 */

import { createInterface } from 'readline';
import { MCPClientManager } from './mcp/mcp-client-manager.js';
import type {
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCError,
} from './types/mcp.js';

// Initialize MCP Client Manager
const manager = new MCPClientManager();

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

        await manager.loadConfig(configPath);
        await manager.startAll();

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
        const tools = manager.listAllTools();

        sendResponse(id, {
          tools,
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
          sendError(id, -32602, 'Tool name is required');
          return;
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    sendError(id, -32000, errorMessage);
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
