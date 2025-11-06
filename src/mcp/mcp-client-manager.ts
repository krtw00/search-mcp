/**
 * MCP Client Manager - Manages multiple MCP clients and aggregates their tools
 */

import { readFile } from 'fs/promises';
import { MCPClient } from './mcp-client.js';
import type {
  MCPServersConfig,
  ToolMetadata,
  ToolCallResponse,
} from '../types/mcp.js';

export interface AggregatedToolMetadata {
  name: string; // Format: "serverName.toolName"
  description: string;
  serverName: string;
  originalName: string;
  inputSchema?: any;
}

export class MCPClientManager {
  private clients = new Map<string, MCPClient>();
  private tools = new Map<string, AggregatedToolMetadata>();

  /**
   * Load MCP servers configuration from file
   */
  async loadConfig(configPath: string): Promise<void> {
    const configContent = await readFile(configPath, 'utf-8');
    const config: MCPServersConfig = JSON.parse(configContent);

    // Create MCP clients for each enabled server
    for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
      if (serverConfig.enabled !== false) {
        const client = new MCPClient(serverName, serverConfig);
        this.clients.set(serverName, client);
      }
    }

    console.log(`Loaded ${this.clients.size} MCP server configurations`);
  }

  /**
   * Start all MCP server processes
   */
  async startAll(): Promise<void> {
    const startPromises = Array.from(this.clients.entries()).map(
      async ([name, client]) => {
        try {
          console.log(`Starting MCP server: ${name}...`);
          await client.start();
          console.log(`✓ Started MCP server: ${name}`);
        } catch (error) {
          console.error(`✗ Failed to start MCP server: ${name}`, error);
          throw error;
        }
      }
    );

    await Promise.all(startPromises);
    console.log(`All ${this.clients.size} MCP servers started`);

    // Fetch and aggregate tools from all servers
    await this.aggregateTools();
  }

  /**
   * Stop all MCP server processes
   */
  async stopAll(): Promise<void> {
    const stopPromises = Array.from(this.clients.values()).map((client) =>
      client.stop()
    );

    await Promise.all(stopPromises);
    this.clients.clear();
    this.tools.clear();

    console.log('All MCP servers stopped');
  }

  /**
   * Fetch tools from all MCP servers and aggregate them
   */
  private async aggregateTools(): Promise<void> {
    this.tools.clear();

    for (const [serverName, client] of this.clients.entries()) {
      try {
        const toolsResponse = await client.listTools();
        const tools = toolsResponse.tools || [];

        console.log(`[${serverName}] Found ${tools.length} tools`);

        for (const tool of tools) {
          const aggregatedTool: AggregatedToolMetadata = {
            name: `${serverName}.${tool.name}`,
            description: tool.description,
            serverName,
            originalName: tool.name,
            inputSchema: tool.inputSchema,
          };

          this.tools.set(aggregatedTool.name, aggregatedTool);
        }
      } catch (error) {
        console.error(`Failed to fetch tools from ${serverName}:`, error);
      }
    }

    console.log(`Aggregated ${this.tools.size} tools from all servers`);
  }

  /**
   * List all aggregated tools (lightweight version - no inputSchema)
   */
  listAllTools(): ToolMetadata[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      // Omit inputSchema for context reduction
    }));
  }

  /**
   * List all aggregated tools (full version - with inputSchema)
   */
  listAllToolsFull(): AggregatedToolMetadata[] {
    return Array.from(this.tools.values());
  }

  /**
   * Execute a tool on the appropriate MCP server
   */
  async executeTool(
    toolName: string,
    args: Record<string, any>
  ): Promise<ToolCallResponse> {
    // Parse the tool name (format: "serverName.toolName")
    const parts = toolName.split('.');
    if (parts.length !== 2) {
      throw new Error(`Invalid tool name format: ${toolName}. Expected "serverName.toolName"`);
    }

    const [serverName, originalToolName] = parts;

    // Find the client
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server not found: ${serverName}`);
    }

    if (!client.isRunning()) {
      throw new Error(`MCP server not running: ${serverName}`);
    }

    // Execute the tool
    try {
      const response = await client.callTool(originalToolName, args);
      return response;
    } catch (error) {
      throw new Error(
        `Failed to execute tool ${toolName}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get statistics about the MCP servers
   */
  getStats() {
    return {
      totalServers: this.clients.size,
      runningServers: Array.from(this.clients.values()).filter((c) =>
        c.isRunning()
      ).length,
      totalTools: this.tools.size,
      servers: Array.from(this.clients.entries()).map(([name, client]) => ({
        name,
        running: client.isRunning(),
        toolCount: Array.from(this.tools.values()).filter(
          (t) => t.serverName === name
        ).length,
      })),
    };
  }

  /**
   * Refresh tools from all servers
   */
  async refreshTools(): Promise<void> {
    await this.aggregateTools();
  }
}
