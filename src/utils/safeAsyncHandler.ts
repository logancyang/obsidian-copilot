import { logError } from "@/logger";

/**
 * One wrapper per handler identity, so a call site can wrap during render
 * without breaking a `memo`'d child's shallow prop comparison. The wrapper
 * closes over nothing but the handler, which makes reuse indistinguishable
 * from a fresh wrapper. Entries live exactly as long as the handler is
 * reachable elsewhere; the wrapper's own reference back to its key does not
 * keep the pair alive.
 */
const wrappersByHandler = new WeakMap<object, unknown>();

/**
 * Adapts an async handler for a void-returning callback slot (JSX event props,
 * Obsidian callbacks) so its rejection is logged instead of becoming an
 * unhandled promise rejection. The handler is invoked synchronously with the
 * original arguments — only the returned promise's rejection path changes.
 *
 * The returned closure is as referentially stable as the handler passed in: the
 * same handler always yields the same wrapper, so a `useCallback`-stable
 * handler needs no `useMemo` around this call. An inline arrow re-created every
 * render still yields a new wrapper, exactly as it would without this call.
 *
 * @param handler - Async function to adapt; its arguments are forwarded
 *   unchanged and its resolved value is discarded.
 * @returns A void-returning closure with the same parameter signature.
 */
export function safeAsyncHandler<Args extends unknown[]>(
  handler: (...args: Args) => Promise<unknown>
): (...args: Args) => void {
  const cached = wrappersByHandler.get(handler);
  if (cached) {
    return cached as (...args: Args) => void;
  }

  const wrapped = (...args: Args): void => {
    handler(...args).catch((error) => {
      logError("safeAsyncHandler: async handler rejected:", error);
    });
  };
  wrappersByHandler.set(handler, wrapped);
  return wrapped;
}
