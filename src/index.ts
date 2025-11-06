import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// サーバーインスタンスを作成します。
// logger: true を設定すると、リクエスト情報などがコンソールに出力され、開発に便利です。
const server: FastifyInstance = Fastify({
  logger: true
});

// サーバーが正常に起動しているかを確認するためのルート（APIエンドポイント）
server.get('/', async (request, reply) => {
  return { status: 'ok' };
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
