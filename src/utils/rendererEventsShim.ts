import { Platform } from "obsidian";
import { EventEmitter } from "node:events";

type SetMaxListenersFn = (n?: number, ...targets: unknown[]) => void;
type MarkedFn = SetMaxListenersFn & { [APPLIED]?: boolean };

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
 * We must patch the **EventEmitter class** itself, not the namespace object
 * produced by `import * as events from "node:events"`. esbuild's CJS interop
 * compiles a star-import to `W(require("node:events"))`, where `W` returns a
 * fresh `{ default: target, ...target }` namespace — a *copy* of the
 * module's properties. Mutating that copy does not affect what other
 * consumers see when they read `require("events").setMaxListeners` live at
 * call time (which is exactly what the bundled SDK does).
 *
 * Node's events module is the EventEmitter class itself
 * (`module.exports = EventEmitter`, plus a `module.exports.EventEmitter`
 * self-reference). A named import resolves to that class — not a wrapper —
 * so assigning to its static `setMaxListeners` mutates the live property
 * every other importer reads. The patch runs as a side effect at module
 * load; a side-effect import in `main.ts` placed before any SDK-touching
 * import is sufficient because ES module evaluation follows the dependency
 * graph.
 *
 * The wrapper drops the throw only when every supplied target looks like an
 * `AbortSignal`; unrelated misuse still propagates.
 *
 * Desktop (Electron renderer) only. On mobile there is no `node:events` (it's
 * marked external and resolves to `undefined`) and no Claude Agent SDK to shim,
 * so this is a no-op there. The mobile guard returns BEFORE any `EventEmitter`
 * access, which is why this must not run at module load: a side-effect call
 * referencing `EventEmitter` crashes the whole plugin on mobile during import
 * (`undefined is not an object`). Call it once from `onload` instead.
 */
export function installRendererEventsShim(): void {
  if (Platform.isMobile) return;
  const target = EventEmitter as unknown as { setMaxListeners: MarkedFn };
  const original = target.setMaxListeners;
  if (original[APPLIED]) return;

  const wrapped: MarkedFn = function (this: unknown, ...args: unknown[]): void {
    try {
      (original as unknown as (...a: unknown[]) => void).apply(this, args);
    } catch (err) {
      const tail = args.slice(1);
      if (tail.length === 0 || !tail.every(hasAbortSignalShape)) throw err;
    }
  };
  wrapped[APPLIED] = true;

  target.setMaxListeners = wrapped;
}
