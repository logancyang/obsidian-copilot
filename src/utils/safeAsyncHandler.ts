import { logError } from "@/logger";

const wrappersByHandler = new WeakMap<object, unknown>();

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
