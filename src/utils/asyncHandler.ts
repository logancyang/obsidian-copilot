import { logError } from "@/logger";

/**
 * Adapt an async callback to a void-returning UI handler while ensuring every
 * synchronous throw and promise rejection reaches the plugin logger.
 *
 * @param handler - Async callback to invoke with the UI-provided arguments.
 * @param context - Operation label included with any reported failure.
 * @returns A void-returning callback suitable for lifecycle and UI APIs.
 */
export function toVoidHandler<Args extends unknown[]>(
  handler: (...args: Args) => void | Promise<unknown>,
  context: string
): (...args: Args) => void {
  return (...args: Args): void => {
    try {
      void Promise.resolve(handler(...args)).catch((error: unknown) =>
        logError(`${context} failed`, error)
      );
    } catch (error) {
      logError(`${context} failed`, error);
    }
  };
}
