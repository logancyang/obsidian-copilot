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

/**
 * LLM onboarding and configuration errors.
 * These typed errors are used to surface missing credentials or model
 * configuration issues as in-chat messages instead of popup notices.
 */
export class MissingApiKeyError extends Error {
  constructor(message: string = "API key is not configured.") {
    super(message);
    this.name = "MissingApiKeyError";
    Object.setPrototypeOf(this, MissingApiKeyError.prototype);
  }
}

export class MissingPlusLicenseError extends Error {
  constructor(message: string = "Copilot Plus license key is not configured.") {
    super(message);
    this.name = "MissingPlusLicenseError";
    Object.setPrototypeOf(this, MissingPlusLicenseError.prototype);
  }
}

export class MissingModelKeyError extends Error {
  constructor(message: string = "No model key found. Please select a model in settings.") {
    super(message);
    this.name = "MissingModelKeyError";
    Object.setPrototypeOf(this, MissingModelKeyError.prototype);
  }
}

/**
 * Thrown when a user explicitly cancels a modal dialog.
 * Callers can catch this to distinguish cancellation from actual errors.
 */
export class UserCancelledError extends Error {
  constructor() {
    super("User cancelled");
    this.name = "UserCancelledError";
    Object.setPrototypeOf(this, UserCancelledError.prototype);
  }
}
