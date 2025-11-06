/**
 * Input Validator - Validates tool parameters against their schema
 */

import { ValidationError } from '../errors.js';

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  default?: any;
  enum?: any[];
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

export class InputValidator {
  /**
   * Validate tool parameters against their schema
   */
  static validateToolParameters(
    schema: ToolParameter[],
    parameters: Record<string, any>
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required parameters
    for (const param of schema) {
      const value = parameters[param.name];

      if (param.required && (value === undefined || value === null)) {
        errors.push(`Required parameter missing: ${param.name}`);
        continue;
      }

      // Skip validation if value is not provided and not required
      if (value === undefined || value === null) {
        continue;
      }

      // Type validation
      const typeError = this.validateType(value, param);
      if (typeError) {
        errors.push(typeError);
      }
    }

    // Check for unknown parameters
    const knownParams = new Set(schema.map(p => p.name));
    for (const paramName of Object.keys(parameters)) {
      if (!knownParams.has(paramName)) {
        errors.push(`Unknown parameter: ${paramName}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate a single parameter's type and constraints
   */
  private static validateType(value: any, param: ToolParameter): string | null {
    switch (param.type) {
      case 'string':
        return this.validateString(value, param);

      case 'number':
        return this.validateNumber(value, param);

      case 'boolean':
        return this.validateBoolean(value, param);

      case 'array':
        return this.validateArray(value, param);

      case 'object':
        return this.validateObject(value, param);

      default:
        return null;
    }
  }

  /**
   * Validate string type
   */
  private static validateString(value: any, param: ToolParameter): string | null {
    if (typeof value !== 'string') {
      return `Parameter ${param.name} must be a string`;
    }

    // Enum validation
    if (param.enum && !param.enum.includes(value)) {
      return `Parameter ${param.name} must be one of: ${param.enum.join(', ')}`;
    }

    // Pattern validation (regex)
    if (param.pattern) {
      try {
        const regex = new RegExp(param.pattern);
        if (!regex.test(value)) {
          return `Parameter ${param.name} does not match pattern: ${param.pattern}`;
        }
      } catch (error) {
        return `Invalid regex pattern for ${param.name}`;
      }
    }

    // Length validation
    if (param.minLength !== undefined && value.length < param.minLength) {
      return `Parameter ${param.name} must be at least ${param.minLength} characters`;
    }
    if (param.maxLength !== undefined && value.length > param.maxLength) {
      return `Parameter ${param.name} must be at most ${param.maxLength} characters`;
    }

    return null;
  }

  /**
   * Validate number type
   */
  private static validateNumber(value: any, param: ToolParameter): string | null {
    if (typeof value !== 'number' || isNaN(value)) {
      return `Parameter ${param.name} must be a number`;
    }

    // Enum validation
    if (param.enum && !param.enum.includes(value)) {
      return `Parameter ${param.name} must be one of: ${param.enum.join(', ')}`;
    }

    // Range validation
    if (param.minimum !== undefined && value < param.minimum) {
      return `Parameter ${param.name} must be >= ${param.minimum}`;
    }
    if (param.maximum !== undefined && value > param.maximum) {
      return `Parameter ${param.name} must be <= ${param.maximum}`;
    }

    return null;
  }

  /**
   * Validate boolean type
   */
  private static validateBoolean(value: any, param: ToolParameter): string | null {
    if (typeof value !== 'boolean') {
      return `Parameter ${param.name} must be a boolean`;
    }
    return null;
  }

  /**
   * Validate array type
   */
  private static validateArray(value: any, param: ToolParameter): string | null {
    if (!Array.isArray(value)) {
      return `Parameter ${param.name} must be an array`;
    }

    // Length validation
    if (param.minLength !== undefined && value.length < param.minLength) {
      return `Parameter ${param.name} must have at least ${param.minLength} items`;
    }
    if (param.maxLength !== undefined && value.length > param.maxLength) {
      return `Parameter ${param.name} must have at most ${param.maxLength} items`;
    }

    return null;
  }

  /**
   * Validate object type
   */
  private static validateObject(value: any, param: ToolParameter): string | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return `Parameter ${param.name} must be an object`;
    }
    return null;
  }

  /**
   * Sanitize SQL input (prevent SQL injection)
   */
  static sanitizeSqlInput(input: string): string {
    // Remove potentially dangerous characters
    return input.replace(/['";\\]/g, '');
  }

  /**
   * Sanitize HTML input (prevent XSS)
   */
  static sanitizeHtmlInput(input: string): string {
    return input
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  /**
   * Validate and throw error if invalid
   */
  static validateOrThrow(
    schema: ToolParameter[],
    parameters: Record<string, any>,
    toolName: string
  ): void {
    const result = this.validateToolParameters(schema, parameters);
    if (!result.valid) {
      throw new ValidationError(
        `Validation failed for tool ${toolName}`,
        undefined,
        result.errors
      );
    }
  }
}
