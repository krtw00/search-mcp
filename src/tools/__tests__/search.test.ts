import { describe, it, expect } from 'vitest';
import { searchImplementation } from '../search.js';

describe('Search Tool', () => {
  it('should return search results', async () => {
    const result = await searchImplementation({
      query: 'test query',
    });
    expect(result.query).toBe('test query');
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.count).toBe(result.results.length);
  });

  it('should respect limit parameter', async () => {
    const result = await searchImplementation({
      query: 'test',
      limit: 2,
    });
    expect(result.results.length).toBeLessThanOrEqual(2);
  });

  it('should use default limit when not specified', async () => {
    const result = await searchImplementation({
      query: 'test',
    });
    expect(result.results.length).toBeLessThanOrEqual(10);
  });

  it('should throw error when query is missing', async () => {
    await expect(searchImplementation({})).rejects.toThrow('query parameter is required');
  });

  it('should include proper result structure', async () => {
    const result = await searchImplementation({
      query: 'test',
    });
    expect(result.results[0]).toHaveProperty('id');
    expect(result.results[0]).toHaveProperty('title');
    expect(result.results[0]).toHaveProperty('score');
  });
});
