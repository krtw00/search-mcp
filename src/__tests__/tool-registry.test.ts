import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../tool-registry.js';
import type { ToolMetadata, ToolImplementation } from '../types.js';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  const mockMetadata: ToolMetadata = {
    name: 'test-tool',
    description: 'A test tool',
    parameters: [
      {
        name: 'param1',
        type: 'string',
        description: 'Test parameter',
        required: true,
      },
    ],
  };

  const mockImplementation: ToolImplementation = async parameters => {
    return { result: 'test result', ...parameters };
  };

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('register', () => {
    it('should register a tool', () => {
      registry.register(mockMetadata, mockImplementation);
      const tool = registry.get('test-tool');
      expect(tool).toBeDefined();
      expect(tool?.metadata.name).toBe('test-tool');
    });

    it('should allow registering multiple tools', () => {
      const metadata2: ToolMetadata = {
        name: 'test-tool-2',
        description: 'Another test tool',
        parameters: [],
      };
      registry.register(mockMetadata, mockImplementation);
      registry.register(metadata2, mockImplementation);

      expect(registry.list().length).toBe(2);
    });
  });

  describe('list', () => {
    it('should return empty array when no tools registered', () => {
      const tools = registry.list();
      expect(tools).toEqual([]);
    });

    it('should return all registered tools metadata', () => {
      registry.register(mockMetadata, mockImplementation);
      const tools = registry.list();

      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe('test-tool');
      expect(tools[0].description).toBe('A test tool');
    });
  });

  describe('get', () => {
    it('should return undefined for non-existent tool', () => {
      const tool = registry.get('non-existent');
      expect(tool).toBeUndefined();
    });

    it('should return tool metadata and implementation', () => {
      registry.register(mockMetadata, mockImplementation);
      const tool = registry.get('test-tool');

      expect(tool).toBeDefined();
      expect(tool?.metadata).toEqual(mockMetadata);
      expect(tool?.implementation).toBe(mockImplementation);
    });
  });

  describe('execute', () => {
    it('should execute a registered tool', async () => {
      registry.register(mockMetadata, mockImplementation);
      const result = await registry.execute('test-tool', { param1: 'value1' });

      expect(result.result).toBe('test result');
      expect(result.param1).toBe('value1');
    });

    it('should throw error for non-existent tool', async () => {
      await expect(registry.execute('non-existent', {})).rejects.toThrow(
        'Tool not found: non-existent'
      );
    });

    it('should pass parameters to implementation', async () => {
      const spyImplementation: ToolImplementation = async parameters => {
        return parameters;
      };
      registry.register(mockMetadata, spyImplementation);

      const params = { param1: 'test-value', param2: 123 };
      const result = await registry.execute('test-tool', params);

      expect(result).toEqual(params);
    });
  });
});
