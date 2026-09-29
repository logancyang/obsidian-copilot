export class CustomError extends Error {
  public code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
    Object.setPrototypeOf(this, CustomError.prototype);
  }
}

export class TimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

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
