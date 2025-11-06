/**
 * Audit Logger - Structured logging for security and compliance
 */

import { writeFile, readFile, appendFile } from 'fs/promises';
import { existsSync } from 'fs';

export type AuditEventType =
  | 'tool_execution'
  | 'authentication'
  | 'authorization'
  | 'configuration_change'
  | 'rate_limit'
  | 'error'
  | 'system';

export type AuditEventLevel = 'info' | 'warn' | 'error' | 'critical';

export interface AuditEvent {
  id: string;
  timestamp: string;
  type: AuditEventType;
  level: AuditEventLevel;
  actor: {
    id: string;
    type: 'user' | 'system' | 'api_key';
    name?: string;
  };
  action: string;
  resource?: {
    type: string;
    id: string;
    name?: string;
  };
  result: 'success' | 'failure';
  details?: any;
  metadata?: {
    ip?: string;
    userAgent?: string;
    sessionId?: string;
    [key: string]: any;
  };
  duration?: number; // milliseconds
  error?: {
    message: string;
    code: string;
    stack?: string;
  };
}

export interface AuditLogOptions {
  logFilePath?: string;
  maxFileSize?: number; // bytes
  retentionDays?: number;
  enableConsoleOutput?: boolean;
  minLevel?: AuditEventLevel;
}

export interface AuditLogQuery {
  startDate?: Date;
  endDate?: Date;
  type?: AuditEventType;
  level?: AuditEventLevel;
  actorId?: string;
  action?: string;
  result?: 'success' | 'failure';
  limit?: number;
  offset?: number;
}

export class AuditLogger {
  private events: AuditEvent[] = [];
  private options: Required<AuditLogOptions>;
  private eventCounter = 0;

  constructor(options: AuditLogOptions = {}) {
    this.options = {
      logFilePath: options.logFilePath || './audit.log',
      maxFileSize: options.maxFileSize || 100 * 1024 * 1024, // 100MB
      retentionDays: options.retentionDays || 90,
      enableConsoleOutput: options.enableConsoleOutput ?? true,
      minLevel: options.minLevel || 'info',
    };
  }

  /**
   * Log an audit event
   */
  async log(event: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<void> {
    const auditEvent: AuditEvent = {
      id: this.generateEventId(),
      timestamp: new Date().toISOString(),
      ...event,
    };

    // Check level filter
    if (!this.shouldLog(auditEvent.level)) {
      return;
    }

    // Add to in-memory store
    this.events.push(auditEvent);

    // Keep only recent events in memory (last 10000)
    if (this.events.length > 10000) {
      this.events = this.events.slice(-10000);
    }

    // Write to file
    if (this.options.logFilePath) {
      await this.writeToFile(auditEvent);
    }

    // Console output
    if (this.options.enableConsoleOutput) {
      this.logToConsole(auditEvent);
    }
  }

  /**
   * Log tool execution
   */
  async logToolExecution(
    actorId: string,
    toolName: string,
    parameters: Record<string, any>,
    result: 'success' | 'failure',
    duration: number,
    error?: Error
  ): Promise<void> {
    await this.log({
      type: 'tool_execution',
      level: result === 'success' ? 'info' : 'error',
      actor: { id: actorId, type: 'api_key' },
      action: 'execute',
      resource: { type: 'tool', id: toolName, name: toolName },
      result,
      details: {
        parameters: this.sanitizeParameters(parameters),
      },
      duration,
      error: error
        ? {
            message: error.message,
            code: 'TOOL_EXECUTION_ERROR',
            stack: error.stack,
          }
        : undefined,
    });
  }

  /**
   * Log authentication event
   */
  async logAuthentication(
    actorId: string,
    result: 'success' | 'failure',
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.log({
      type: 'authentication',
      level: result === 'success' ? 'info' : 'warn',
      actor: { id: actorId, type: 'api_key' },
      action: 'authenticate',
      result,
      metadata,
    });
  }

  /**
   * Log authorization event
   */
  async logAuthorization(
    actorId: string,
    permission: string,
    result: 'success' | 'failure'
  ): Promise<void> {
    await this.log({
      type: 'authorization',
      level: result === 'success' ? 'info' : 'warn',
      actor: { id: actorId, type: 'api_key' },
      action: 'check_permission',
      result,
      details: { permission },
    });
  }

  /**
   * Log configuration change
   */
  async logConfigChange(
    actorId: string,
    configKey: string,
    oldValue: any,
    newValue: any
  ): Promise<void> {
    await this.log({
      type: 'configuration_change',
      level: 'info',
      actor: { id: actorId, type: 'system' },
      action: 'update_config',
      resource: { type: 'configuration', id: configKey },
      result: 'success',
      details: {
        oldValue: this.sanitizeValue(oldValue),
        newValue: this.sanitizeValue(newValue),
      },
    });
  }

  /**
   * Log rate limit event
   */
  async logRateLimit(
    actorId: string,
    remaining: number,
    resetAt: number
  ): Promise<void> {
    await this.log({
      type: 'rate_limit',
      level: 'warn',
      actor: { id: actorId, type: 'api_key' },
      action: 'rate_limit_exceeded',
      result: 'failure',
      details: {
        remaining,
        resetAt: new Date(resetAt).toISOString(),
      },
    });
  }

  /**
   * Query audit logs
   */
  query(query: AuditLogQuery = {}): AuditEvent[] {
    let filtered = [...this.events];

    // Filter by date range
    if (query.startDate) {
      const startTime = query.startDate.getTime();
      filtered = filtered.filter(
        e => new Date(e.timestamp).getTime() >= startTime
      );
    }

    if (query.endDate) {
      const endTime = query.endDate.getTime();
      filtered = filtered.filter(
        e => new Date(e.timestamp).getTime() <= endTime
      );
    }

    // Filter by type
    if (query.type) {
      filtered = filtered.filter(e => e.type === query.type);
    }

    // Filter by level
    if (query.level) {
      filtered = filtered.filter(e => e.level === query.level);
    }

    // Filter by actor
    if (query.actorId) {
      filtered = filtered.filter(e => e.actor.id === query.actorId);
    }

    // Filter by action
    if (query.action) {
      filtered = filtered.filter(e => e.action === query.action);
    }

    // Filter by result
    if (query.result) {
      filtered = filtered.filter(e => e.result === query.result);
    }

    // Apply pagination
    const offset = query.offset || 0;
    const limit = query.limit || 100;

    return filtered.slice(offset, offset + limit);
  }

  /**
   * Get audit statistics
   */
  getStats(timeWindowMs?: number): {
    total: number;
    byType: Record<AuditEventType, number>;
    byLevel: Record<AuditEventLevel, number>;
    byResult: Record<'success' | 'failure', number>;
    averageDuration: number;
  } {
    let events = this.events;

    // Filter by time window if specified
    if (timeWindowMs) {
      const cutoff = Date.now() - timeWindowMs;
      events = events.filter(
        e => new Date(e.timestamp).getTime() >= cutoff
      );
    }

    const byType: Record<string, number> = {};
    const byLevel: Record<string, number> = {};
    const byResult: Record<string, number> = {};
    let totalDuration = 0;
    let countWithDuration = 0;

    for (const event of events) {
      byType[event.type] = (byType[event.type] || 0) + 1;
      byLevel[event.level] = (byLevel[event.level] || 0) + 1;
      byResult[event.result] = (byResult[event.result] || 0) + 1;

      if (event.duration !== undefined) {
        totalDuration += event.duration;
        countWithDuration++;
      }
    }

    return {
      total: events.length,
      byType: byType as any,
      byLevel: byLevel as any,
      byResult: byResult as any,
      averageDuration: countWithDuration > 0 ? totalDuration / countWithDuration : 0,
    };
  }

  /**
   * Export logs to file
   */
  async export(filePath: string, query?: AuditLogQuery): Promise<void> {
    const events = query ? this.query(query) : this.events;
    const content = events.map(e => JSON.stringify(e)).join('\n');
    await writeFile(filePath, content, 'utf-8');
  }

  /**
   * Load logs from file
   */
  async load(filePath: string): Promise<void> {
    if (!existsSync(filePath)) {
      return;
    }

    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        this.events.push(event);
      } catch (error) {
        console.error('Failed to parse audit log line:', error);
      }
    }

    console.error(`Loaded ${lines.length} audit log entries from ${filePath}`);
  }

  /**
   * Clear old logs based on retention policy
   */
  async cleanup(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.options.retentionDays);
    const cutoffTime = cutoffDate.getTime();

    const initialCount = this.events.length;
    this.events = this.events.filter(
      e => new Date(e.timestamp).getTime() >= cutoffTime
    );

    const removed = initialCount - this.events.length;
    if (removed > 0) {
      console.error(`Cleaned up ${removed} old audit log entries`);
    }

    return removed;
  }

  /**
   * Write event to file
   */
  private async writeToFile(event: AuditEvent): Promise<void> {
    try {
      const line = JSON.stringify(event) + '\n';
      await appendFile(this.options.logFilePath, line, 'utf-8');
    } catch (error) {
      console.error('Failed to write audit log to file:', error);
    }
  }

  /**
   * Log to console
   */
  private logToConsole(event: AuditEvent): void {
    const prefix = `[AUDIT] [${event.level.toUpperCase()}] [${event.type}]`;
    const message = `${prefix} ${event.action} by ${event.actor.id}: ${event.result}`;

    switch (event.level) {
      case 'error':
      case 'critical':
        console.error(message, event.error || '');
        break;
      case 'warn':
        console.warn(message);
        break;
      default:
        console.log(message);
    }
  }

  /**
   * Check if event should be logged based on level
   */
  private shouldLog(level: AuditEventLevel): boolean {
    const levels: AuditEventLevel[] = ['info', 'warn', 'error', 'critical'];
    const minIndex = levels.indexOf(this.options.minLevel);
    const eventIndex = levels.indexOf(level);
    return eventIndex >= minIndex;
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    this.eventCounter++;
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    return `${timestamp}-${this.eventCounter}-${random}`;
  }

  /**
   * Sanitize parameters to remove sensitive data
   */
  private sanitizeParameters(params: Record<string, any>): Record<string, any> {
    const sanitized = { ...params };
    const sensitiveKeys = ['password', 'secret', 'token', 'apiKey', 'api_key'];

    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
        sanitized[key] = '***REDACTED***';
      }
    }

    return sanitized;
  }

  /**
   * Sanitize value for logging
   */
  private sanitizeValue(value: any): any {
    if (typeof value === 'object' && value !== null) {
      return this.sanitizeParameters(value);
    }
    return value;
  }
}

// Global singleton instance
let globalAuditLogger: AuditLogger | null = null;

/**
 * Get the global audit logger instance
 */
export function getAuditLogger(): AuditLogger {
  if (!globalAuditLogger) {
    globalAuditLogger = new AuditLogger({
      logFilePath: './logs/audit.log',
      enableConsoleOutput: true,
      minLevel: 'info',
    });
  }
  return globalAuditLogger;
}

/**
 * Initialize the global audit logger with custom options
 */
export function initializeAuditLogger(options: AuditLogOptions): AuditLogger {
  globalAuditLogger = new AuditLogger(options);
  return globalAuditLogger;
}
