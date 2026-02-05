/**
 * Custom error types for GitHub Copilot authentication flow.
 * Using custom error classes instead of string comparison for type safety.
 */

/**
 * Error thrown when user cancels the authentication flow or auth is reset.
 * This includes:
 * - User clicking "Cancel" button during device code polling
 * - Component unmounting during async operations
 * - Auth reset called during in-flight operations (e.g., token refresh)
 */
export class AuthCancelledError extends Error {
  readonly name = "AuthCancelledError";

  constructor(message = "Authentication cancelled by user.") {
    super(message);
    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, AuthCancelledError.prototype);
  }
}

/**
 * Type guard to check if an error is an AuthCancelledError.
 * Uses both instanceof check and error.name comparison for robustness
 * (handles cases where multiple module instances might exist due to bundling).
 * @param error - The error to check
 * @returns True if the error is an AuthCancelledError
 */
export function isAuthCancelledError(error: unknown): error is AuthCancelledError {
  return (
    error instanceof AuthCancelledError ||
    (error instanceof Error && error.name === "AuthCancelledError")
  );
}
