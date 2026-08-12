import { logError } from "@/logger";

/**
 * Adapts an async handler for a void-returning callback slot (JSX event props,
 * Obsidian callbacks) so its rejection is logged instead of becoming an
 * unhandled promise rejection. The handler is invoked synchronously with the
 * original arguments — only the returned promise's rejection path changes.
 *
 * @param handler - Async function to adapt; its arguments are forwarded
 *   unchanged and its resolved value is discarded.
 * @returns A void-returning closure with the same parameter signature.
 */
export function safeAsyncHandler<Args extends unknown[]>(
  handler: (...args: Args) => Promise<unknown>
): (...args: Args) => void {
  return (...args: Args): void => {
    handler(...args).catch((error) => {
      logError("safeAsyncHandler: async handler rejected:", error);
    });
  };
}
