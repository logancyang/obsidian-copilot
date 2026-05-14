/**
 * Returned by {@link debounce}. Calling it schedules the underlying function,
 * with `cancel` and `flush` controls modeled after `lodash.debounce`.
 */
export interface DebouncedFunction<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): ReturnType<T> | undefined;
  cancel(): void;
  flush(): ReturnType<T> | undefined;
}

export interface DebounceOptions {
  leading?: boolean;
  trailing?: boolean;
}

/**
 * Delay-invoking `func` until `wait` ms have elapsed since the last call.
 * Supports the `leading` / `trailing` options and `cancel` / `flush` methods
 * used by the `lodash.debounce` API the codebase relied on previously.
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
  options: DebounceOptions = {}
): DebouncedFunction<T> {
  const leading = options.leading ?? false;
  const trailing = options.trailing ?? true;

  let timeoutId: number | undefined;
  let lastArgs: Parameters<T> | undefined;
  let lastResult: ReturnType<T> | undefined;
  let hasPendingTrailingCall = false;

  const invoke = (): ReturnType<T> | undefined => {
    const args = lastArgs;
    lastArgs = undefined;
    hasPendingTrailingCall = false;
    if (!args) return lastResult;
    lastResult = func(...args) as ReturnType<T>;
    return lastResult;
  };

  const startTimer = () => {
    timeoutId = window.setTimeout(() => {
      timeoutId = undefined;
      if (trailing && hasPendingTrailingCall) {
        invoke();
      }
    }, wait);
  };

  const debounced = ((...args: Parameters<T>) => {
    lastArgs = args;
    hasPendingTrailingCall = true;

    const isFirstCallInWindow = timeoutId === undefined;
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }

    if (isFirstCallInWindow && leading) {
      invoke();
    }

    startTimer();
    return lastResult;
  }) as DebouncedFunction<T>;

  debounced.cancel = () => {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    lastArgs = undefined;
    hasPendingTrailingCall = false;
  };

  debounced.flush = () => {
    if (timeoutId === undefined) return lastResult;
    window.clearTimeout(timeoutId);
    timeoutId = undefined;
    if (hasPendingTrailingCall) {
      return invoke();
    }
    return lastResult;
  };

  return debounced;
}
