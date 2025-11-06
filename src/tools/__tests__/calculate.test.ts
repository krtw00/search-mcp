import { describe, it, expect } from 'vitest';
import { calculateImplementation } from '../calculate.js';

describe('Calculate Tool', () => {
  describe('Addition', () => {
    it('should add two positive numbers', async () => {
      const result = await calculateImplementation({
        operation: 'add',
        a: 5,
        b: 3,
      });
      expect(result.result).toBe(8);
      expect(result.operation).toBe('add');
      expect(result.a).toBe(5);
      expect(result.b).toBe(3);
    });

    it('should add negative numbers', async () => {
      const result = await calculateImplementation({
        operation: 'add',
        a: -5,
        b: -3,
      });
      expect(result.result).toBe(-8);
    });
  });

  describe('Subtraction', () => {
    it('should subtract two numbers', async () => {
      const result = await calculateImplementation({
        operation: 'subtract',
        a: 10,
        b: 3,
      });
      expect(result.result).toBe(7);
    });
  });

  describe('Multiplication', () => {
    it('should multiply two numbers', async () => {
      const result = await calculateImplementation({
        operation: 'multiply',
        a: 4,
        b: 5,
      });
      expect(result.result).toBe(20);
    });
  });

  describe('Division', () => {
    it('should divide two numbers', async () => {
      const result = await calculateImplementation({
        operation: 'divide',
        a: 10,
        b: 2,
      });
      expect(result.result).toBe(5);
    });

    it('should throw error on division by zero', async () => {
      await expect(
        calculateImplementation({
          operation: 'divide',
          a: 10,
          b: 0,
        })
      ).rejects.toThrow('Division by zero is not allowed');
    });
  });

  describe('Error Handling', () => {
    it('should throw error for missing parameters', async () => {
      await expect(
        calculateImplementation({
          operation: 'add',
        })
      ).rejects.toThrow('operation, a, and b parameters are required');
    });

    it('should throw error for non-number parameters', async () => {
      await expect(
        calculateImplementation({
          operation: 'add',
          a: '5',
          b: 3,
        })
      ).rejects.toThrow('a and b must be numbers');
    });

    it('should throw error for unknown operation', async () => {
      await expect(
        calculateImplementation({
          operation: 'modulo',
          a: 10,
          b: 3,
        })
      ).rejects.toThrow('Unknown operation: modulo');
    });
  });

  describe('Timestamp', () => {
    it('should include timestamp in result', async () => {
      const result = await calculateImplementation({
        operation: 'add',
        a: 1,
        b: 1,
      });
      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).toString()).not.toBe('Invalid Date');
    });
  });
});
