import { isDesktopRuntime, requireNodeModule } from "@/utils/desktopRuntime";

type SetMaxListenersFn = (n?: number, ...targets: unknown[]) => void;
type MarkedFn = SetMaxListenersFn & { [APPLIED]?: boolean };

const APPLIED = Symbol.for("obsidian-copilot:setMaxListeners-shim");

function hasAbortSignalShape(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as { aborted?: unknown; dispatchEvent?: unknown };
  return typeof v.aborted === "boolean" && typeof v.dispatchEvent === "function";
}

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
