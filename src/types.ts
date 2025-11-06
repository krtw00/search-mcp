/**
 * ツールのパラメータ定義
 */
export interface ToolParameter {
  name: string;
  type: string;
  description: string;
  required?: boolean;
}

/**
 * ツールのメタデータ
 */
export interface ToolMetadata {
  name: string;
  description: string;
  parameters: ToolParameter[];
}

/**
 * ツール実行リクエスト
 */
export interface ToolCallRequest {
  name: string;
  parameters: Record<string, any>;
}

/**
 * ツール実行レスポンス
 */
export interface ToolCallResponse {
  success: boolean;
  result?: any;
  error?: string;
}

/**
 * ツール実装の型
 */
export type ToolImplementation = (parameters: Record<string, any>) => Promise<any>;
