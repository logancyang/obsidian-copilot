export class CustomError extends Error {
  public code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
    // This is needed in TypeScript when extending built-in classes
    Object.setPrototypeOf(this, CustomError.prototype);
  }
}
