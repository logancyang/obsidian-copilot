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

/**
 * Thrown by a backend's `prompt()` when it determines the agent is not signed
 * in (e.g. the Claude CLI has no saved login and no env-based credentials).
 * `runTurn` catches it like any prompt failure — replacing the empty
 * placeholder with a visible error and ending the session in `"error"` — while
 * the actionable "Sign in" CTA is surfaced separately by the status pill. A
 * distinct type (rather than a bare `Error`) lets callers and tests recognize
 * the recoverable auth case deterministically.
 */
export class AuthRequiredError extends Error {
  constructor(message = "Not signed in. Use the Sign in button above to continue.") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

/** JSON-RPC standard "Method not found" error code. */
export const JSONRPC_METHOD_NOT_FOUND = -32601;
