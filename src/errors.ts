/**
 * Error Classes for Search MCP Server
 *
 * Provides a hierarchy of error classes for proper error handling
 * and appropriate HTTP status codes.
 */

/**
 * Base error class for all MCP errors
 */
export class MCPError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: any
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      details: this.details,
    };
  }
}

/**
 * Tool not found error
 */
export class ToolNotFoundError extends MCPError {
  constructor(message: string, toolName?: string) {
    super(message, 'TOOL_NOT_FOUND', 404, { toolName });
  }
}

/**
 * Tool is disabled
 */
export class ToolDisabledError extends MCPError {
  constructor(message: string, toolName?: string) {
    super(message, 'TOOL_DISABLED', 403, { toolName });
  }
}

/**
 * Tool execution failed
 */
export class ToolExecutionError extends MCPError {
  constructor(message: string, public originalError?: any) {
    super(message, 'TOOL_EXECUTION_ERROR', 500, {
      originalError: originalError?.message || originalError,
    });
  }
}

/**
 * Validation error
 */
export class ValidationError extends MCPError {
  constructor(message: string, public field?: string, public validationErrors?: string[]) {
    super(message, 'VALIDATION_ERROR', 400, {
      field,
      errors: validationErrors,
    });
  }
}

/**
 * Timeout error
 */
export class TimeoutError extends MCPError {
  constructor(message: string, public timeoutMs?: number) {
    super(message, 'TIMEOUT', 408, { timeoutMs });
  }
}

/**
 * Authentication error
 */
export class AuthenticationError extends MCPError {
  constructor(message: string) {
    super(message, 'AUTHENTICATION_ERROR', 401);
  }
}

/**
 * Authorization error (insufficient permissions)
 */
export class AuthorizationError extends MCPError {
  constructor(message: string, public requiredPermission?: string) {
    super(message, 'AUTHORIZATION_ERROR', 403, { requiredPermission });
  }
}

/**
 * Rate limit exceeded
 */
export class RateLimitError extends MCPError {
  constructor(message: string, public retryAfter?: number) {
    super(message, 'RATE_LIMIT_EXCEEDED', 429, { retryAfter });
  }
}

/**
 * Configuration error
 */
export class ConfigurationError extends MCPError {
  constructor(message: string, public configPath?: string) {
    super(message, 'CONFIGURATION_ERROR', 500, { configPath });
  }
}

/**
 * MCP Server connection error
 */
export class MCPServerError extends MCPError {
  constructor(message: string, public serverName?: string) {
    super(message, 'MCP_SERVER_ERROR', 502, { serverName });
  }
}

/**
 * Helper function to check if an error is an MCPError
 */
export function isMCPError(error: any): error is MCPError {
  return error instanceof MCPError;
}

/**
 * Helper function to convert any error to MCPError
 */
export function toMCPError(error: any): MCPError {
  if (isMCPError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new MCPError(error.message, 'INTERNAL_ERROR', 500);
  }

  return new MCPError(
    typeof error === 'string' ? error : 'Unknown error',
    'INTERNAL_ERROR',
    500
  );
}
