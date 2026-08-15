import { isDesktopRuntime, requireNodeModule } from "@/utils/desktopRuntime";

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
 * We must patch the **EventEmitter class** itself, not a namespace copy such
 * as the `{ default: target, ...target }` object esbuild's CJS interop
 * builds for `import * as events from "node:events"` — mutating a copy does
 * not affect what other consumers see when they read
 * `require("events").setMaxListeners` live at call time (which is exactly
 * what the bundled SDK does). Node's events module is the EventEmitter class
 * itself (`module.exports = EventEmitter`, plus a `module.exports.EventEmitter`
 * self-reference), so reading `.EventEmitter` off the live
 * `require("events")` module object yields that class — not a wrapper — and
 * assigning to its static `setMaxListeners` mutates the property every other
 * importer reads.
 *
 * The wrapper drops the throw only when every supplied target looks like an
 * `AbortSignal`; unrelated misuse still propagates.
 *
 * Desktop (Electron renderer) only. On mobile (including
 * `app.emulateMobile(true)`) there is no `node:events` (it's marked external
 * and resolves to `undefined`) and no Claude Agent SDK to shim, so this is a
 * no-op there. The desktop-runtime guard returns BEFORE the events module is
 * required, and the require itself happens at call time — never at module
 * evaluation — so importing this module is safe on every platform. Call it
 * once from `onload`.
 */
export function installRendererEventsShim(): void {
  if (!isDesktopRuntime()) return;
  const { EventEmitter } = requireNodeModule<typeof import("node:events")>("events");
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
