# Plugin Development Guide

Obsidian-specific runtime concerns: how to reach the `app`, how to make network
requests, and how to stay correct across pop-out windows. Read this when
touching plugin runtime code rather than pure logic.

## Accessing the Obsidian `app`

Don't use the global `app`. It's a footgun in popout windows and hides dependencies from tests.

- **React components** → `useApp()` from `@/context`. Don't add `app` as a new prop just to thread it down — call `useApp()` at the leaf.
- **Non-React modules** → take `app` (or just the slice you need, e.g. `app.vault`) as a parameter.
- **Plugin entry points** → `this.app` on the `Plugin` instance.

Never write `declare const app: App;` in new code. A few legacy files do — don't follow them.

## HTTP requests

Prefer Obsidian's `requestUrl` (from `obsidian`) over the global `fetch` for any plugin network call. `requestUrl` bypasses browser CORS, works on mobile and desktop, and matches the rest of the codebase. The standard wrapper is `safeFetch` in `src/utils.ts` — use it when you want a `Response`-shaped return. Reach for native `fetch` only when you need true streaming responses or AbortSignal cancellation; `requestUrl` supports neither.

## Picking the right `document` / `window` (popout-window safety)

Obsidian supports pop-out windows. The plugin loads in the main window but views can live in any window. Picking the wrong `Document` / `Window` produces stale references, off-screen popovers, listeners on the wrong window, or DOM nodes that never render. Use this decision order:

1. **`element.doc` / `element.win`** — preferred. Obsidian augments every `Node` with `.doc: Document` and `.win: Window` that always reflect the element's current owner. Use whenever you have any DOM node in scope (a ref, an event target, a component's container, a `Range`'s `startContainer`).
   - `containerRef.current?.doc.addEventListener(...)`
   - `range.startContainer.win.innerWidth`
   - `editor.getRootElement()?.doc`
2. **`global activeDocument` / `activeWindow`** — fallback only. These point to whichever window is _focused right now_. Correct semantics for actions that follow user focus (e.g., the AddImageModal file picker; selectionchange registration at plugin load), but wrong when the action belongs to a specific view (a chat in a popout while the user clicks back to the main window).
3. **`document` / `window` globals** — almost always wrong. They are aliases for the main window even when the user is interacting with a popout. Avoid in new code. If you find yourself reaching for them, it's a sign the surrounding code should be taking a `Document`/`Window` parameter or deriving from a DOM ref.
4. **`element.ownerDocument`** — works (standard DOM), but prefer `.doc` for consistency with the codebase. They return the same `Document` for any mounted `HTMLElement`. `.doc` is shorter and typed non-nullable.

**Listeners that may outlive a window migration:** capture the `Document` / `Window` at registration and remove on the same one:

```ts
const doc = containerRef.current?.doc;
if (!doc) return;
doc.addEventListener("keydown", handler);
return () => doc.removeEventListener("keydown", handler);
```

Do **not** rely on `activeDocument` at registration _and_ removal — it can shift between the two calls if focus moves.

**View migrated to a new window:** for a view that owns React or other long-lived renderers, register `this.containerEl.onWindowMigrated((win) => { ... })` in `onOpen`. The callback fires when Obsidian reparents the element into a different window's document. Tear down and rebuild the renderer there so it captures the new window. Save the returned destroy function and call it in `onClose` to avoid leaks. `CopilotView` is the canonical example — it unmounts and recreates the React root on migration so Lexical re-binds to the popout's window.

**Cross-realm `instanceof`:** popout windows have their own `Element`, `MouseEvent`, etc., so standard `instanceof` checks fail across windows. Use Obsidian's `element.instanceOf(HTMLElement)` and `event.instanceOf(MouseEvent)` when checking type across realms.

**Tests (jsdom):** `jest.setup.js` polyfills `Node.doc` / `Node.win` so plugin code using these properties works under jsdom. Don't add `instanceof` guards that depend on the Obsidian-augmented globals without considering the test environment.
