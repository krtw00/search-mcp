import type { ToolMetadata, ToolImplementation } from './types.js';
import { InputValidator } from './validation/input-validator.js';
import { ToolNotFoundError, ToolExecutionError } from './errors.js';

/**
 * ツールレジストリ
 * ツールの登録、一覧取得、実行を管理します
 */
export class ToolRegistry {
  private tools: Map<string, { metadata: ToolMetadata; implementation: ToolImplementation }>;

  constructor() {
    this.tools = new Map();
  }

  /**
   * ツールを登録します
   */
  register(metadata: ToolMetadata, implementation: ToolImplementation): void {
    this.tools.set(metadata.name, { metadata, implementation });
  }

  /**
   * 登録されているツールの一覧を取得します
   */
  list(): ToolMetadata[] {
    return Array.from(this.tools.values()).map(tool => tool.metadata);
  }

  /**
   * ツールを名前で検索します
   */
  get(name: string): { metadata: ToolMetadata; implementation: ToolImplementation } | undefined {
    return this.tools.get(name);
  }

  /**
   * ツールを実行します
   */
  async execute(name: string, parameters: Record<string, any>): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new ToolNotFoundError(`Tool not found: ${name}`, name);
    }

    // Validate parameters against schema
    if (tool.metadata.parameters && tool.metadata.parameters.length > 0) {
      InputValidator.validateOrThrow(
        tool.metadata.parameters,
        parameters,
        name
      );
    }

    // Execute the tool
    try {
      return await tool.implementation(parameters);
    } catch (error) {
      throw new ToolExecutionError(
        `Failed to execute tool ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }
}
