/**
 * Parallel Executor - Execute multiple tool calls concurrently
 */

import type { MCPClientManager } from '../mcp/mcp-client-manager.js';

export interface ParallelExecutionRequest {
  toolName: string;
  parameters: Record<string, any>;
  id?: string; // Optional identifier for this request
}

export interface ParallelExecutionResult {
  id?: string;
  toolName: string;
  success: boolean;
  result?: any;
  error?: {
    message: string;
    code: string;
    details?: any;
  };
  executionTime: number;
}

export interface ParallelExecutionOptions {
  maxConcurrency?: number;   // Maximum number of concurrent executions
  timeout?: number;           // Timeout in milliseconds for each execution
  continueOnError?: boolean;  // Continue executing remaining tasks if one fails
  aggregateResults?: boolean; // Return aggregated results or individual results
}

export interface ParallelExecutionSummary {
  total: number;
  successful: number;
  failed: number;
  totalTime: number;
  results: ParallelExecutionResult[];
}

export class ParallelExecutor {
  constructor(private manager: MCPClientManager) {}

  /**
   * Execute multiple tool calls in parallel
   */
  async executeParallel(
    requests: ParallelExecutionRequest[],
    options: ParallelExecutionOptions = {}
  ): Promise<ParallelExecutionSummary> {
    const {
      maxConcurrency = 10,
      timeout = 30000,
      continueOnError = true,
    } = options;

    const startTime = Date.now();
    const results: ParallelExecutionResult[] = [];

    // Execute in batches based on max concurrency
    const batches = this.createBatches(requests, maxConcurrency);

    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map(request => this.executeSingle(request, timeout, continueOnError))
      );
      results.push(...batchResults);

      // Stop if any failed and continueOnError is false
      if (!continueOnError && batchResults.some(r => !r.success)) {
        break;
      }
    }

    const totalTime = Date.now() - startTime;
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return {
      total: results.length,
      successful,
      failed,
      totalTime,
      results,
    };
  }

  /**
   * Execute multiple tool calls in parallel and aggregate results
   */
  async executeAndAggregate<T>(
    requests: ParallelExecutionRequest[],
    aggregator: (results: any[]) => T,
    options: ParallelExecutionOptions = {}
  ): Promise<{ aggregated: T; summary: ParallelExecutionSummary }> {
    const summary = await this.executeParallel(requests, options);
    const successfulResults = summary.results
      .filter(r => r.success)
      .map(r => r.result);

    const aggregated = aggregator(successfulResults);

    return {
      aggregated,
      summary,
    };
  }

  /**
   * Execute a single tool call with timeout
   */
  private async executeSingle(
    request: ParallelExecutionRequest,
    timeout: number,
    continueOnError: boolean
  ): Promise<ParallelExecutionResult> {
    const startTime = Date.now();

    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Execution timeout after ${timeout}ms`));
        }, timeout);
      });

      // Execute tool with timeout
      const executionPromise = this.manager.executeTool(
        request.toolName,
        request.parameters
      );

      const result = await Promise.race([executionPromise, timeoutPromise]);
      const executionTime = Date.now() - startTime;

      return {
        id: request.id,
        toolName: request.toolName,
        success: true,
        result,
        executionTime,
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;

      const errorResult: ParallelExecutionResult = {
        id: request.id,
        toolName: request.toolName,
        success: false,
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          code: 'EXECUTION_ERROR',
          details: error,
        },
        executionTime,
      };

      // Log error if continuing
      if (continueOnError) {
        console.error(
          `Tool execution failed: ${request.toolName}`,
          error instanceof Error ? error.message : error
        );
      }

      return errorResult;
    }
  }

  /**
   * Create batches from requests based on max concurrency
   */
  private createBatches<T>(
    items: T[],
    batchSize: number
  ): T[][] {
    const batches: T[][] = [];

    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    return batches;
  }

  /**
   * Execute with retries
   */
  async executeWithRetry(
    request: ParallelExecutionRequest,
    maxRetries: number = 3,
    retryDelay: number = 1000
  ): Promise<ParallelExecutionResult> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = await this.executeSingle(request, 30000, true);

      if (result.success) {
        return result;
      }

      lastError = new Error(result.error?.message || 'Execution failed');

      // Wait before retry (exponential backoff)
      if (attempt < maxRetries) {
        const delay = retryDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        console.error(
          `Retrying ${request.toolName} (attempt ${attempt + 2}/${maxRetries + 1}) after ${delay}ms`
        );
      }
    }

    // All retries failed
    return {
      id: request.id,
      toolName: request.toolName,
      success: false,
      error: {
        message: lastError?.message || 'All retry attempts failed',
        code: 'MAX_RETRIES_EXCEEDED',
      },
      executionTime: 0,
    };
  }

  /**
   * Execute with circuit breaker pattern
   */
  async executeWithCircuitBreaker(
    requests: ParallelExecutionRequest[],
    failureThreshold: number = 0.5,
    options: ParallelExecutionOptions = {}
  ): Promise<ParallelExecutionSummary> {
    const results: ParallelExecutionResult[] = [];
    let failureRate = 0;
    const circuitOpen = false;

    for (const request of requests) {
      // Check circuit breaker
      if (circuitOpen) {
        results.push({
          id: request.id,
          toolName: request.toolName,
          success: false,
          error: {
            message: 'Circuit breaker open - too many failures',
            code: 'CIRCUIT_BREAKER_OPEN',
          },
          executionTime: 0,
        });
        continue;
      }

      // Execute
      const result = await this.executeSingle(
        request,
        options.timeout || 30000,
        true
      );
      results.push(result);

      // Calculate failure rate
      const completed = results.length;
      const failed = results.filter(r => !r.success).length;
      failureRate = failed / completed;

      // Open circuit if threshold exceeded
      if (failureRate > failureThreshold && completed >= 5) {
        console.error(
          `Circuit breaker opened: failure rate ${(failureRate * 100).toFixed(1)}% exceeds threshold ${(failureThreshold * 100).toFixed(1)}%`
        );
        break;
      }
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalTime = results.reduce((sum, r) => sum + r.executionTime, 0);

    return {
      total: results.length,
      successful,
      failed,
      totalTime,
      results,
    };
  }

  /**
   * Map-reduce style parallel execution
   */
  async mapReduce<T, R>(
    requests: ParallelExecutionRequest[],
    mapper: (result: any, index: number) => T,
    reducer: (accumulator: R, value: T) => R,
    initialValue: R,
    options: ParallelExecutionOptions = {}
  ): Promise<R> {
    const summary = await this.executeParallel(requests, options);

    const mappedResults = summary.results
      .filter(r => r.success)
      .map((r, index) => mapper(r.result, index));

    return mappedResults.reduce(reducer, initialValue);
  }

  /**
   * Get execution statistics
   */
  getExecutionStats(summary: ParallelExecutionSummary): {
    averageTime: number;
    minTime: number;
    maxTime: number;
    successRate: number;
  } {
    const times = summary.results.map(r => r.executionTime);

    return {
      averageTime: times.reduce((a, b) => a + b, 0) / times.length || 0,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      successRate: summary.successful / summary.total,
    };
  }
}

// Global singleton instance
let globalParallelExecutor: ParallelExecutor | null = null;

/**
 * Get the global parallel executor instance
 */
export function getParallelExecutor(manager: MCPClientManager): ParallelExecutor {
  if (!globalParallelExecutor) {
    globalParallelExecutor = new ParallelExecutor(manager);
  }
  return globalParallelExecutor;
}

/**
 * Initialize the global parallel executor
 */
export function initializeParallelExecutor(manager: MCPClientManager): ParallelExecutor {
  globalParallelExecutor = new ParallelExecutor(manager);
  return globalParallelExecutor;
}
