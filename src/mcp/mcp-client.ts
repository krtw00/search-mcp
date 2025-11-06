/**
 * MCP Client - Manages communication with a single backend MCP server
 */

import { spawn, type ChildProcess } from 'child_process';
import { createInterface, type Interface } from 'readline';
import type {
  MCPServerConfig,
  JSONRPCRequest,
  JSONRPCResponse,
  InitializeResponse,
  ToolsListResponse,
  ToolCallResponse,
} from '../types/mcp.js';

export class MCPClient {
  private process: ChildProcess | null = null;
  private readline: Interface | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number | string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }>();

  constructor(
    private serverName: string,
    private config: MCPServerConfig
  ) {}

  /**
   * Start the MCP server process and initialize connection
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Spawn the MCP server process
      this.process = spawn(this.config.command, this.config.args, {
        env: { ...process.env, ...this.config.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (!this.process.stdin || !this.process.stdout) {
        reject(new Error(`Failed to spawn MCP server: ${this.serverName}`));
        return;
      }

      // Setup readline for line-by-line JSON-RPC message reading
      this.readline = createInterface({
        input: this.process.stdout,
        crlfDelay: Infinity,
      });

      this.readline.on('line', (line) => {
        this.handleResponse(line);
      });

      // Handle process errors
      this.process.on('error', (error) => {
        console.error(`[${this.serverName}] Process error:`, error);
        reject(error);
      });

      this.process.stderr?.on('data', (data) => {
        console.error(`[${this.serverName}] stderr:`, data.toString());
      });

      this.process.on('exit', (code) => {
        console.log(`[${this.serverName}] Process exited with code ${code}`);
      });

      // Wait a bit for process to start, then initialize
      setTimeout(async () => {
        try {
          await this.initialize();
          resolve();
        } catch (error) {
          reject(error);
        }
      }, 100);
    });
  }

  /**
   * Stop the MCP server process
   */
  async stop(): Promise<void> {
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }

    if (this.process) {
      this.process.kill();
      this.process = null;
    }

    // Reject all pending requests
    for (const [id, { reject }] of this.pendingRequests) {
      reject(new Error('MCP client stopped'));
    }
    this.pendingRequests.clear();
  }

  /**
   * Initialize the MCP connection
   */
  private async initialize(): Promise<InitializeResponse> {
    const response = await this.sendRequest('initialize', {
      protocolVersion: '1.0.0',
      clientInfo: {
        name: 'search-mcp',
        version: '1.0.0',
      },
      capabilities: {},
    });

    return response as InitializeResponse;
  }

  /**
   * List all tools provided by this MCP server
   */
  async listTools(): Promise<ToolsListResponse> {
    const response = await this.sendRequest('tools/list', {});
    return response as ToolsListResponse;
  }

  /**
   * Execute a tool on this MCP server
   */
  async callTool(name: string, args: Record<string, any>): Promise<ToolCallResponse> {
    const response = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    });
    return response as ToolCallResponse;
  }

  /**
   * Send a JSON-RPC request to the MCP server
   */
  private async sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin) {
        reject(new Error('MCP client not started'));
        return;
      }

      const id = ++this.requestId;
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      // Store the promise handlers
      this.pendingRequests.set(id, { resolve, reject });

      // Send the request
      const requestLine = JSON.stringify(request) + '\n';
      this.process.stdin.write(requestLine);

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30000);
    });
  }

  /**
   * Handle a JSON-RPC response from the MCP server
   */
  private handleResponse(line: string): void {
    try {
      const response: JSONRPCResponse = JSON.parse(line);
      const pending = this.pendingRequests.get(response.id);

      if (!pending) {
        console.warn(`[${this.serverName}] Received response for unknown request ID:`, response.id);
        return;
      }

      this.pendingRequests.delete(response.id);

      if (response.error) {
        pending.reject(new Error(response.error.message));
      } else {
        pending.resolve(response.result);
      }
    } catch (error) {
      console.error(`[${this.serverName}] Failed to parse response:`, line, error);
    }
  }

  /**
   * Get server name
   */
  getName(): string {
    return this.serverName;
  }

  /**
   * Check if the client is running
   */
  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }
}
