/**
 * MCP Server configuration types
 */

export interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface MCPServersConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

/**
 * JSON-RPC 2.0 types
 */

export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: any;
}

export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: JSONRPCError;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: any;
}

/**
 * MCP Protocol types
 */

export interface ToolMetadata {
  name: string;
  description: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

export interface InitializeRequest {
  protocolVersion: string;
  clientInfo: {
    name: string;
    version: string;
  };
  capabilities?: any;
}

export interface InitializeResponse {
  protocolVersion: string;
  serverInfo: {
    name: string;
    version: string;
  };
  capabilities: {
    tools?: {};
  };
}

export interface ToolsListResponse {
  tools: ToolMetadata[];
}

export interface ToolCallRequest {
  name: string;
  arguments: Record<string, any>;
}

export interface ToolCallResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
}
