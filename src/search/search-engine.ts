/**
 * Search Engine - Text search functionality for MCP tools
 */

import type { ToolMetadata } from '../types.js';

export type SearchMode = 'partial' | 'prefix' | 'exact' | 'fuzzy';

export interface SearchOptions {
  mode?: SearchMode;
  caseSensitive?: boolean;
  searchFields?: ('name' | 'description')[];
  limit?: number;
  offset?: number;
}

export interface SearchResult<T = ToolMetadata> {
  item: T;
  score: number;
  matches: {
    field: string;
    indices: [number, number][];
  }[];
}

export interface SearchResponse<T = ToolMetadata> {
  results: SearchResult<T>[];
  total: number;
  limit: number;
  offset: number;
  query: string;
}

export class SearchEngine {
  /**
   * Search tools by text query
   */
  static search<T extends { name: string; description: string }>(
    items: T[],
    query: string,
    options: SearchOptions = {}
  ): SearchResponse<T> {
    const {
      mode = 'partial',
      caseSensitive = false,
      searchFields = ['name', 'description'],
      limit = 50,
      offset = 0,
    } = options;

    if (!query || query.trim().length === 0) {
      // Return all items if no query
      return {
        results: items.slice(offset, offset + limit).map(item => ({
          item,
          score: 0,
          matches: [],
        })),
        total: items.length,
        limit,
        offset,
        query: '',
      };
    }

    const normalizedQuery = caseSensitive ? query : query.toLowerCase();

    // Search and score results
    const scoredResults: SearchResult<T>[] = [];

    for (const item of items) {
      const matches: SearchResult<T>['matches'] = [];
      let totalScore = 0;

      for (const field of searchFields) {
        const text = item[field] as string;
        const normalizedText = caseSensitive ? text : text.toLowerCase();

        const { matched, score, indices } = this.matchText(
          normalizedText,
          normalizedQuery,
          mode
        );

        if (matched) {
          totalScore += score * (field === 'name' ? 2 : 1); // Name matches are worth 2x
          matches.push({ field, indices });
        }
      }

      if (totalScore > 0) {
        scoredResults.push({
          item,
          score: totalScore,
          matches,
        });
      }
    }

    // Sort by score (descending)
    scoredResults.sort((a, b) => b.score - a.score);

    // Apply pagination
    const total = scoredResults.length;
    const paginatedResults = scoredResults.slice(offset, offset + limit);

    return {
      results: paginatedResults,
      total,
      limit,
      offset,
      query,
    };
  }

  /**
   * Match text against query using specified mode
   */
  private static matchText(
    text: string,
    query: string,
    mode: SearchMode
  ): { matched: boolean; score: number; indices: [number, number][] } {
    switch (mode) {
      case 'exact':
        return this.exactMatch(text, query);
      case 'prefix':
        return this.prefixMatch(text, query);
      case 'fuzzy':
        return this.fuzzyMatch(text, query);
      case 'partial':
      default:
        return this.partialMatch(text, query);
    }
  }

  /**
   * Exact match
   */
  private static exactMatch(
    text: string,
    query: string
  ): { matched: boolean; score: number; indices: [number, number][] } {
    if (text === query) {
      return {
        matched: true,
        score: 100,
        indices: [[0, text.length]],
      };
    }
    return { matched: false, score: 0, indices: [] };
  }

  /**
   * Prefix match (starts with)
   */
  private static prefixMatch(
    text: string,
    query: string
  ): { matched: boolean; score: number; indices: [number, number][] } {
    if (text.startsWith(query)) {
      return {
        matched: true,
        score: 80,
        indices: [[0, query.length]],
      };
    }
    return { matched: false, score: 0, indices: [] };
  }

  /**
   * Partial match (contains)
   */
  private static partialMatch(
    text: string,
    query: string
  ): { matched: boolean; score: number; indices: [number, number][] } {
    const index = text.indexOf(query);
    if (index !== -1) {
      // Score higher if match is at the beginning
      const score = index === 0 ? 70 : 50;
      return {
        matched: true,
        score,
        indices: [[index, index + query.length]],
      };
    }
    return { matched: false, score: 0, indices: [] };
  }

  /**
   * Fuzzy match (Levenshtein distance-based)
   */
  private static fuzzyMatch(
    text: string,
    query: string
  ): { matched: boolean; score: number; indices: [number, number][] } {
    // Simple fuzzy matching using word-based approach
    const textWords = text.split(/\s+/);
    const queryWords = query.split(/\s+/);

    let bestScore = 0;
    const indices: [number, number][] = [];

    for (const queryWord of queryWords) {
      for (let i = 0; i < textWords.length; i++) {
        const textWord = textWords[i];
        const distance = this.levenshteinDistance(textWord, queryWord);
        const similarity = 1 - distance / Math.max(textWord.length, queryWord.length);

        if (similarity > 0.6) {
          // At least 60% similar
          bestScore = Math.max(bestScore, similarity * 40);
          // Calculate word position in original text
          const wordStart = text.indexOf(textWord);
          if (wordStart !== -1) {
            indices.push([wordStart, wordStart + textWord.length]);
          }
        }
      }
    }

    return {
      matched: bestScore > 0,
      score: bestScore,
      indices,
    };
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private static levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Search with multiple queries (OR logic)
   */
  static searchMultiple<T extends { name: string; description: string }>(
    items: T[],
    queries: string[],
    options: SearchOptions = {}
  ): SearchResponse<T> {
    const allResults = new Map<T, SearchResult<T>>();

    for (const query of queries) {
      const response = this.search(items, query, { ...options, limit: items.length, offset: 0 });

      for (const result of response.results) {
        const existing = allResults.get(result.item);
        if (existing) {
          // Merge scores and matches
          existing.score = Math.max(existing.score, result.score);
          existing.matches.push(...result.matches);
        } else {
          allResults.set(result.item, result);
        }
      }
    }

    // Convert to array and sort
    const results = Array.from(allResults.values());
    results.sort((a, b) => b.score - a.score);

    // Apply pagination
    const { limit = 50, offset = 0 } = options;
    const total = results.length;
    const paginatedResults = results.slice(offset, offset + limit);

    return {
      results: paginatedResults,
      total,
      limit,
      offset,
      query: queries.join(' OR '),
    };
  }

  /**
   * Highlight matches in text
   */
  static highlightMatches(
    text: string,
    indices: [number, number][],
    highlightStart: string = '<mark>',
    highlightEnd: string = '</mark>'
  ): string {
    if (indices.length === 0) {
      return text;
    }

    // Sort indices by start position
    const sortedIndices = [...indices].sort((a, b) => a[0] - b[0]);

    let result = '';
    let lastIndex = 0;

    for (const [start, end] of sortedIndices) {
      // Add text before match
      result += text.substring(lastIndex, start);
      // Add highlighted match
      result += highlightStart + text.substring(start, end) + highlightEnd;
      lastIndex = end;
    }

    // Add remaining text
    result += text.substring(lastIndex);

    return result;
  }
}
