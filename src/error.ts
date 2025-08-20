export class CustomError extends Error {
  public code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
    // This is needed in TypeScript when extending built-in classes
    Object.setPrototypeOf(this, CustomError.prototype);
  }
}

/**
 * TimeoutError class for consistent timeout error handling
 */
export class TimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
    // This is needed in TypeScript when extending built-in classes
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}
