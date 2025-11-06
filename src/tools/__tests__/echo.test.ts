import { describe, it, expect } from 'vitest';
import { echoImplementation } from '../echo.js';

describe('Echo Tool', () => {
  it('should echo the message', async () => {
    const result = await echoImplementation({
      message: 'Hello, World!',
    });
    expect(result.echo).toBe('Hello, World!');
  });

  it('should include timestamp', async () => {
    const result = await echoImplementation({
      message: 'Test message',
    });
    expect(result.timestamp).toBeDefined();
    expect(new Date(result.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('should throw error when message is missing', async () => {
    await expect(echoImplementation({})).rejects.toThrow('message parameter is required');
  });

  it('should handle empty string message', async () => {
    await expect(
      echoImplementation({
        message: '',
      })
    ).rejects.toThrow('message parameter is required');
  });
});
