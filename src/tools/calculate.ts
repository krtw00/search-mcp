import type { ToolMetadata, ToolImplementation } from '../types.js';

/**
 * Calculateツールのメタデータ
 */
export const calculateMetadata: ToolMetadata = {
  name: 'calculate',
  description: '2つの数値の加算、減算、乗算、除算を実行します',
  parameters: [
    {
      name: 'operation',
      type: 'string',
      description: '実行する演算（add, subtract, multiply, divide）',
      required: true
    },
    {
      name: 'a',
      type: 'number',
      description: '最初の数値',
      required: true
    },
    {
      name: 'b',
      type: 'number',
      description: '2番目の数値',
      required: true
    }
  ]
};

/**
 * Calculateツールの実装
 */
export const calculateImplementation: ToolImplementation = async (parameters) => {
  const { operation, a, b } = parameters;

  // バリデーション
  if (!operation || a === undefined || b === undefined) {
    throw new Error('operation, a, and b parameters are required');
  }

  if (typeof a !== 'number' || typeof b !== 'number') {
    throw new Error('a and b must be numbers');
  }

  // 演算実行
  let result: number;
  switch (operation) {
    case 'add':
      result = a + b;
      break;
    case 'subtract':
      result = a - b;
      break;
    case 'multiply':
      result = a * b;
      break;
    case 'divide':
      if (b === 0) {
        throw new Error('Division by zero is not allowed');
      }
      result = a / b;
      break;
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }

  return {
    operation,
    a,
    b,
    result,
    timestamp: new Date().toISOString()
  };
};
