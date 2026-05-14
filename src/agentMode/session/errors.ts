/**
 * Cross-layer error types raised by the `BackendProcess` contract. Both the
 * ACP runtime (`acp/AcpBackendProcess`) and the in-process SDK adapter
 * (`sdk/ClaudeSdkBackendProcess`) raise `MethodUnsupportedError` when the
 * backend doesn't implement an optional capability; callers in `session/`,
 * `backends/*`, and `ui/` catch it and degrade gracefully.
 */

/**
 * Thrown when a backend does not implement an optional `BackendProcess`
 * method (e.g. `setSessionModel`, `resumeSession`, `loadSession`). Callers
 * should catch this and degrade gracefully (e.g. disable the model picker,
 * fall through to the next preloader strategy).
 */
export class MethodUnsupportedError extends Error {
  constructor(method: string) {
    super(`Agent does not implement ${method}`);
    this.name = "MethodUnsupportedError";
  }
}

/** JSON-RPC standard "Method not found" error code. */
export const JSONRPC_METHOD_NOT_FOUND = -32601;
