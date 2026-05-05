import * as nodeEvents from "node:events";

type SetMaxListenersFn = (n?: number, ...targets: unknown[]) => void;
type MarkedFn = SetMaxListenersFn & { [APPLIED]?: boolean };
type EventsModuleShape = { setMaxListeners: MarkedFn };

const APPLIED = Symbol.for("obsidian-copilot:setMaxListeners-shim");

function hasAbortSignalShape(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as { aborted?: unknown; dispatchEvent?: unknown };
  return typeof v.aborted === "boolean" && typeof v.dispatchEvent === "function";
}

/**
 * Obsidian runs plugins in Electron's renderer, where `AbortController` is
 * the web-platform global. The Claude Agent SDK calls
 * `events.setMaxListeners(n, abortController.signal)` to suppress
 * `MaxListenersExceededWarning`. A V8 realm mismatch between Electron's
 * renderer context and the `AbortSignal` instance can fail Node's internal
 * `isEventTarget` check, throwing `ERR_INVALID_ARG_TYPE`. The behaviour is
 * intermittent across environments.
 *
 * Wrap the call so throws are dropped only when every supplied target looks
 * like an `AbortSignal`; unrelated misuse still propagates. The patch runs
 * as a side effect at module load — a side-effect import in `main.ts`
 * placed before any SDK-touching import is sufficient because ES module
 * evaluation follows the dependency graph, so this module's body runs
 * before any later import that transitively loads the SDK.
 *
 * Cast via `unknown`: `@types/node` exposes `setMaxListeners` as a static on
 * `EventEmitter` but not on the module namespace, while at runtime esbuild
 * compiles `node:events` (listed `external` in `esbuild.config.mjs`) to a
 * `require("events")` reference whose `setMaxListeners` property is mutable.
 */
function installShim(): void {
  const eventsModule = nodeEvents as unknown as EventsModuleShape;
  const original = eventsModule.setMaxListeners;
  if (original[APPLIED]) return;

  const wrapped: MarkedFn = function (this: unknown, ...args: unknown[]) {
    try {
      return original.apply(this, args as Parameters<SetMaxListenersFn>);
    } catch (err) {
      const tail = args.slice(1);
      if (tail.length === 0 || !tail.every(hasAbortSignalShape)) throw err;
    }
  } as MarkedFn;
  wrapped[APPLIED] = true;

  eventsModule.setMaxListeners = wrapped;
}

installShim();
