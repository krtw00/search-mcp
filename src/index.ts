import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { ToolRegistry } from './tool-registry.js';
import { echoMetadata, echoImplementation } from './tools/echo.js';
import { searchMetadata, searchImplementation } from './tools/search.js';
import type { ToolCallRequest, ToolCallResponse } from './types.js';

// サーバーインスタンスを作成します。
// logger: true を設定すると、リクエスト情報などがコンソールに出力され、開発に便利です。
const server: FastifyInstance = Fastify({
  logger: true
});

// ツールレジストリを作成し、ツールを登録します
const toolRegistry = new ToolRegistry();
toolRegistry.register(echoMetadata, echoImplementation);
toolRegistry.register(searchMetadata, searchImplementation);

// サーバーが正常に起動しているかを確認するためのルート（APIエンドポイント）
server.get('/', async (request, reply) => {
  return { status: 'ok', message: 'MCP Server is running' };
});

// 利用可能なツールの一覧を取得するエンドポイント
server.get('/tools', async (request, reply) => {
  return {
    tools: toolRegistry.list()
  };
});

// ツールを実行するエンドポイント
server.post<{ Body: ToolCallRequest }>('/tools/call', async (request, reply) => {
  try {
    const { name, parameters } = request.body;

    if (!name) {
      return reply.code(400).send({
        success: false,
        error: 'Tool name is required'
      } as ToolCallResponse);
    }

    const result = await toolRegistry.execute(name, parameters || {});

    return {
      success: true,
      result
    } as ToolCallResponse;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return reply.code(400).send({
      success: false,
      error: errorMessage
    } as ToolCallResponse);
  }
});

/**
 * サーバーを起動するための関数です。
 * この対話環境ではサーバーを永続的に起動できないため、
 * この関数はテスト時などに明示的に呼び出すことになります。
 */
const start = async () => {
  try {
    await server.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

// あとでテストや他のスクリプトからサーバーを起動できるように、
// serverインスタンスとstart関数をエクスポートしておきます。
export { server, start };
