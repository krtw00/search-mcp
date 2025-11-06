import type { ToolMetadata, ToolImplementation } from './types.js';

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
      throw new Error(`Tool not found: ${name}`);
    }
    return await tool.implementation(parameters);
  }
}
