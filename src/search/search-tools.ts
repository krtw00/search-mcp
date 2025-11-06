/**
 * Search Tools - MCP tools for searching aggregated tools
 */

import type { ToolMetadata, ToolImplementation } from '../types.js';
import { SearchEngine, type SearchOptions, type SearchResponse } from './search-engine.js';
import type { AggregatedToolMetadata } from '../mcp/mcp-client-manager.js';

/**
 * Create search tool metadata
 */
export function createSearchToolMetadata(): ToolMetadata {
  return {
    name: 'search_tools',
    description: 'Search for tools by name or description. Supports multiple search modes: partial (default), prefix, exact, and fuzzy matching.',
    parameters: [
      {
        name: 'query',
        type: 'string',
        description: 'Search query text',
        required: true,
        minLength: 1,
      },
      {
        name: 'mode',
        type: 'string',
        description: 'Search mode: partial (contains), prefix (starts with), exact (exact match), or fuzzy (similarity-based)',
        required: false,
        enum: ['partial', 'prefix', 'exact', 'fuzzy'],
        default: 'partial',
      },
      {
        name: 'caseSensitive',
        type: 'boolean',
        description: 'Whether the search should be case-sensitive',
        required: false,
        default: false,
      },
      {
        name: 'searchFields',
        type: 'array',
        description: 'Fields to search in: name, description, or both',
        required: false,
      },
      {
        name: 'limit',
        type: 'number',
        description: 'Maximum number of results to return',
        required: false,
        minimum: 1,
        maximum: 100,
        default: 50,
      },
      {
        name: 'offset',
        type: 'number',
        description: 'Number of results to skip (for pagination)',
        required: false,
        minimum: 0,
        default: 0,
      },
    ],
  };
}

/**
 * Create advanced search tool metadata
 */
export function createAdvancedSearchToolMetadata(): ToolMetadata {
  return {
    name: 'advanced_search',
    description: 'Advanced search with filtering by server, tags, and categories. Combines text search with filters for precise results.',
    parameters: [
      {
        name: 'query',
        type: 'string',
        description: 'Search query text (optional if using filters)',
        required: false,
      },
      {
        name: 'serverName',
        type: 'string',
        description: 'Filter by MCP server name',
        required: false,
      },
      {
        name: 'tags',
        type: 'array',
        description: 'Filter by tags (matches any of the provided tags)',
        required: false,
      },
      {
        name: 'category',
        type: 'string',
        description: 'Filter by category',
        required: false,
      },
      {
        name: 'mode',
        type: 'string',
        description: 'Search mode for text query',
        required: false,
        enum: ['partial', 'prefix', 'exact', 'fuzzy'],
        default: 'partial',
      },
      {
        name: 'limit',
        type: 'number',
        description: 'Maximum number of results',
        required: false,
        minimum: 1,
        maximum: 100,
        default: 50,
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
 * Create search tool implementation
 */
export function createSearchToolImplementation(
  getTools: () => AggregatedToolMetadata[]
): ToolImplementation {
  return async (parameters: Record<string, any>) => {
    const tools = getTools();

    const options: SearchOptions = {
      mode: parameters.mode || 'partial',
      caseSensitive: parameters.caseSensitive || false,
      searchFields: parameters.searchFields || ['name', 'description'],
      limit: parameters.limit || 50,
      offset: parameters.offset || 0,
    };

    const response = SearchEngine.search(tools, parameters.query, options);

    // Format results for MCP
    return {
      results: response.results.map(result => ({
        name: result.item.name,
        description: result.item.description,
        serverName: result.item.serverName,
        originalName: result.item.originalName,
        score: result.score,
        matches: result.matches,
      })),
      total: response.total,
      limit: response.limit,
      offset: response.offset,
      query: response.query,
    };
  };
}

/**
 * Create advanced search tool implementation
 */
export function createAdvancedSearchToolImplementation(
  getTools: () => AggregatedToolMetadata[]
): ToolImplementation {
  return async (parameters: Record<string, any>) => {
    let tools = getTools();

    // Apply filters
    if (parameters.serverName) {
      tools = tools.filter(tool => tool.serverName === parameters.serverName);
    }

    if (parameters.tags && Array.isArray(parameters.tags)) {
      // Note: This requires tools to have tags in their metadata
      // For now, we'll skip this filter as tags aren't in the current schema
      console.warn('Tag filtering not yet implemented - tags not in tool metadata');
    }

    if (parameters.category) {
      // Note: This requires tools to have category in their metadata
      // For now, we'll skip this filter as category isn't in the current schema
      console.warn('Category filtering not yet implemented - category not in tool metadata');
    }

    // Apply text search if query provided
    if (parameters.query) {
      const options: SearchOptions = {
        mode: parameters.mode || 'partial',
        caseSensitive: false,
        searchFields: ['name', 'description'],
        limit: parameters.limit || 50,
        offset: parameters.offset || 0,
      };

      const response = SearchEngine.search(tools, parameters.query, options);

      return {
        results: response.results.map(result => ({
          name: result.item.name,
          description: result.item.description,
          serverName: result.item.serverName,
          originalName: result.item.originalName,
          score: result.score,
          matches: result.matches,
        })),
        total: response.total,
        limit: response.limit,
        offset: response.offset,
        query: response.query,
        filters: {
          serverName: parameters.serverName,
          tags: parameters.tags,
          category: parameters.category,
        },
      };
    } else {
      // No text search, just return filtered results
      const limit = parameters.limit || 50;
      const offset = parameters.offset || 0;
      const total = tools.length;
      const paginatedTools = tools.slice(offset, offset + limit);

      return {
        results: paginatedTools.map(tool => ({
          name: tool.name,
          description: tool.description,
          serverName: tool.serverName,
          originalName: tool.originalName,
          score: 0,
        })),
        total,
        limit,
        offset,
        query: '',
        filters: {
          serverName: parameters.serverName,
          tags: parameters.tags,
          category: parameters.category,
        },
      };
    }
  };
}

/**
 * Create list servers tool metadata
 */
export function createListServersToolMetadata(): ToolMetadata {
  return {
    name: 'list_servers',
    description: 'List all connected MCP servers with their status and tool counts',
    parameters: [],
  };
}

/**
 * Create list servers tool implementation
 */
export function createListServersToolImplementation(
  getStats: () => any
): ToolImplementation {
  return async () => {
    const stats = getStats();

    return {
      totalServers: stats.totalServers,
      runningServers: stats.runningServers,
      totalTools: stats.totalTools,
      servers: stats.servers.map((server: any) => ({
        name: server.name,
        running: server.running,
        toolCount: server.toolCount,
        reconnectionStatus: server.reconnectionStatus,
      })),
    };
  };
}
