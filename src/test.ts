import { server } from './index.js';

/**
 * サーバーの動作確認テスト
 */
async function test() {
  try {
    console.log('=== MCP Server Test ===\n');

    // Test 1: Health check
    console.log('Test 1: Health check');
    const healthResponse = await server.inject({
      method: 'GET',
      url: '/'
    });
    console.log('Response:', JSON.parse(healthResponse.payload));
    console.log('Status:', healthResponse.statusCode);
    console.log('');

    // Test 2: Get tools list
    console.log('Test 2: Get tools list');
    const toolsResponse = await server.inject({
      method: 'GET',
      url: '/tools'
    });
    console.log('Response:', JSON.parse(toolsResponse.payload));
    console.log('Status:', toolsResponse.statusCode);
    console.log('');

    // Test 3: Call echo tool
    console.log('Test 3: Call echo tool');
    const echoResponse = await server.inject({
      method: 'POST',
      url: '/tools/call',
      payload: {
        name: 'echo',
        parameters: {
          message: 'Hello, MCP Server!'
        }
      }
    });
    console.log('Response:', JSON.parse(echoResponse.payload));
    console.log('Status:', echoResponse.statusCode);
    console.log('');

    // Test 4: Call search tool
    console.log('Test 4: Call search tool');
    const searchResponse = await server.inject({
      method: 'POST',
      url: '/tools/call',
      payload: {
        name: 'search',
        parameters: {
          query: 'test query',
          limit: 5
        }
      }
    });
    console.log('Response:', JSON.parse(searchResponse.payload));
    console.log('Status:', searchResponse.statusCode);
    console.log('');

    // Test 5: Error handling - missing parameter
    console.log('Test 5: Error handling - missing parameter');
    const errorResponse = await server.inject({
      method: 'POST',
      url: '/tools/call',
      payload: {
        name: 'echo',
        parameters: {}
      }
    });
    console.log('Response:', JSON.parse(errorResponse.payload));
    console.log('Status:', errorResponse.statusCode);
    console.log('');

    // Test 6: Error handling - unknown tool
    console.log('Test 6: Error handling - unknown tool');
    const unknownToolResponse = await server.inject({
      method: 'POST',
      url: '/tools/call',
      payload: {
        name: 'unknown_tool',
        parameters: {}
      }
    });
    console.log('Response:', JSON.parse(unknownToolResponse.payload));
    console.log('Status:', unknownToolResponse.statusCode);
    console.log('');

    console.log('=== All tests completed ===');
    await server.close();
  } catch (error) {
    console.error('Test failed:', error);
    await server.close();
    process.exit(1);
  }
}

test();
