import type { ToolMetadata, ToolImplementation } from '../types.js';

/**
 * Echoツールのメタデータ
 */
export const echoMetadata: ToolMetadata = {
  name: 'echo',
  description: '入力されたメッセージをそのまま返します',
  parameters: [
    {
      name: 'message',
      type: 'string',
      description: '返すメッセージ',
      required: true
    }
  ]
};

/**
 * Echoツールの実装
 */
export const echoImplementation: ToolImplementation = async (parameters) => {
  const { message } = parameters;

  if (!message) {
    throw new Error('message parameter is required');
  }

  return {
    echo: message,
    timestamp: new Date().toISOString()
  };
};
