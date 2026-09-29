export class MethodUnsupportedError extends Error {
  constructor(method: string) {
    super(`Agent does not implement ${method}`);
    this.name = "MethodUnsupportedError";
  }
}

export class AuthRequiredError extends Error {
  constructor(message = "Not signed in. Use the Sign in button above to continue.") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export const JSONRPC_METHOD_NOT_FOUND = -32601;
