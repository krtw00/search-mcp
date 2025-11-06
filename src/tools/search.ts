import type { ToolMetadata, ToolImplementation } from '../types.js';

/**
 * Searchツールのメタデータ
 */
export const searchMetadata: ToolMetadata = {
  name: 'search',
  description: 'テキストを検索します（プロトタイプ版）',
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: '検索クエリ',
      required: true
    },
    {
      name: 'limit',
      type: 'number',
      description: '返す結果の最大数',
      required: false
    }
  ]
};

/**
 * Searchツールの実装（プロトタイプ版）
 * 実際の検索機能は今後実装します
 */
export const searchImplementation: ToolImplementation = async (parameters) => {
  const { query, limit = 10 } = parameters;

  if (!query) {
    throw new Error('query parameter is required');
  }

  // プロトタイプ版：ダミーデータを返す
  const results = [
    { id: 1, title: `Result for "${query}" - 1`, score: 0.95 },
    { id: 2, title: `Result for "${query}" - 2`, score: 0.87 },
    { id: 3, title: `Result for "${query}" - 3`, score: 0.75 }
  ].slice(0, Math.min(limit as number, 10));

  return {
    query,
    results,
    count: results.length
  };
};
