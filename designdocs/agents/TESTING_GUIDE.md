# Testing Guide

How to test the Copilot plugin across three layers — unit, integration, and
end-to-end. Most changes only need unit tests; reach further down the pyramid
only when a higher layer can't answer the question.

## Test pyramid

| Layer       | Command                             | When to use                                                                                                                                                           |
| ----------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | `npm run test`                      | Pure logic. Fast. Mocks the Obsidian API. Default for any code change that doesn't touch Obsidian itself.                                                             |
| Integration | `npm run test:integration`          | LLM-provider HTTP calls. Requires API keys in `.env.test`.                                                                                                            |
| E2E         | `obsidian` CLI against a real vault | Anything that needs the live React tree, the real Obsidian DOM, or actual settings persistence — UI regressions, settings round-trips, plugin lifecycle, perf checks. |

## Unit tests

- Jest with TypeScript support. `npm run test` runs the unit suite (excludes
  integration tests); run a single test with `npm test -- -t "test name"`.
- Mock the Obsidian API for plugin testing.
- Test files live adjacent to the implementation (`.test.ts`).
- Use `@testing-library/react` for component testing.
- For how to structure code so it's unit-testable — dependency injection, pure
  leaf modules, the litmus test — see [`STYLE_GUIDE.md`](./STYLE_GUIDE.md).

## Integration tests

`npm run test:integration` exercises real LLM-provider HTTP calls and requires
API keys in `.env.test`.

## End-to-end testing (Obsidian CLI)

E2E via the CLI is the slowest and most fragile layer — reach for it only when
the unit/integration layers can't answer the question.

A field guide for coding agents driving the Copilot plugin through the Obsidian
desktop CLI. Everything here was validated against Obsidian `1.12.7` with the
plugin loaded into a real vault. The CLI lives at
`/Applications/Obsidian.app/Contents/MacOS/obsidian` — use the full path; the
`obsidian` shim is not always on `PATH`.

## Get a fresh build into the test vault

```bash
npm run test:vault
```

macOS only. Installs deps, builds, and copies `main.js` / `manifest.json` /
`styles.css` from the current worktree into
`$COPILOT_TEST_VAULT_PATH/.obsidian/plugins/copilot/`, then reloads the plugin
via the Obsidian CLI. Requires `$COPILOT_TEST_VAULT_PATH` (user-level env var)
pointing at a vault that has been opened in Obsidian at least once.

This is the canonical "get my changes running" step — don't hand-roll `npm run
build && cp main.js …`. If the user has multiple Conductor worktrees, whichever
one ran `test:vault` last wins; verify with the preflight in the next section.
The copied manifest carries a development-only version suffix and visible tag
with the commit, clean/dirty state, and bundle hash. A later build in the
worktree does not mutate the deployed plugin; run `test:vault` again to deploy
and reload the new build.

## Reset the test vault's settings

```bash
npm run test:reset-data                 # bundled clean-onboarding fixture
npm run test:reset-data -- <path>       # any data.json you point at
```

Companion to `test:vault`. Overwrites
`$COPILOT_TEST_VAULT_PATH/.obsidian/plugins/copilot/data.json` with a fixture,
then reloads the plugin (same Obsidian CLI reload as `test:vault`) so the reset
takes effect immediately — the reload matters because a running plugin holds
settings in memory and would otherwise overwrite the file on its next save.

With no argument it uses `scripts/test-fixtures/data.clean-onboarding.json`: no
coding agent and no BYOK model configured (empty `providers` / `configuredModels`
/ `backends`), for testing the agent onboarding flow from a clean slate. The
fixture omits `_keychainOnly`, so the plugin loads in disk mode and ignores any
API keys left in the OS keychain from prior runs — a deterministic clean state.
The source file is validated as JSON before the target is touched.

### `data.legacy-byok.json` — one-time BYOK migration

`npm run test:reset-data -- scripts/test-fixtures/data.legacy-byok.json` loads a
pre-versioned legacy install (no `settingsVersion`; legacy `activeModels` +
top-level provider keys; empty new slices apart from one pre-seeded BYOK
Anthropic provider that proves dedup). On the next plugin load,
`runSettingsMigrations` converts the legacy BYOK providers/models into the new
`providers` / `configuredModels` / `backends` shape so they work in OpenCode, and
stamps `settingsVersion`. It runs in disk mode with obvious fake `sk-test-…`
keys. After reset, read back and verify the migrated shape:

```bash
$OBS vault=$VAULT eval code='app.plugins.plugins.copilot.loadData().then(d=>JSON.stringify({
  settingsVersion: d.settingsVersion,
  providers: Object.values(d.providers).map(p=>({type:p.providerType, origin:p.origin.kind, catalog:p.origin.catalogProviderId, hasKey: p.apiKeyKeychainId!=null})),
  configuredModels: d.configuredModels.map(m=>m.info.id),
  chat: d.backends.chat?.enabledModels?.length,
  opencode: d.backends.opencode?.enabledModels?.length,
  legacyUntouched: { anthropicApiKey: d.anthropicApiKey, activeModels: d.activeModels.length }
}))'
```

Expect: `settingsVersion` stamped; routable providers carry a `catalogProviderId`
and a key; `backends.opencode.enabledModels` is non-empty and excludes the
embedding (`BAAI/bge-m3`) and Bedrock rows; exactly one Anthropic BYOK provider
(the pre-seeded one — its descriptor deduped, not re-created); legacy
`anthropicApiKey` and `activeModels` untouched. A second reload must not change
`settingsVersion` or create duplicates (the version gate holds).

## 0. Golden rule: pick the right window first

Obsidian is a single Electron app with one renderer per open vault. The CLI
talks to **one** renderer at a time, and by default that renderer is whichever
vault was touched most recently (focus + last CLI target — _not_ stable across
calls). On a developer machine with several vaults open at once this almost
guarantees that "it worked locally" is meaningless.

**Always pass `vault=<name>` on every command.** The flag is global (works on
any subcommand) and binds the call to a specific renderer.

```bash
OBS=/Applications/Obsidian.app/Contents/MacOS/obsidian
VAULT="$(basename "$COPILOT_TEST_VAULT_PATH")"

$OBS vault=$VAULT vault           # echoes name/path of the targeted vault
```

### Verification gate before any test run

Run this preflight and abort if anything looks off:

```bash
$OBS vault=$VAULT eval code='JSON.stringify({
  vault: app.vault.getName(),
  path:  app.vault.adapter.basePath,
  copilotLoaded: !!app.plugins.plugins.copilot,
  copilotVersion: app.plugins.manifests.copilot?.version,
  buildTag: app.plugins.manifests.copilot?.description?.match(/dev build: ([^ |]+)/)?.[1],
  buildBranch: app.plugins.manifests.copilot?.description?.match(/branch: ([^ |]+)/)?.[1]
})'
```

Check that:

- `vault` matches the intended target
- `copilotLoaded` is `true` (`vault=<name>` will _open_ a known-but-closed
  vault as a fresh renderer — silently. The plugin may not be ready yet; if
  `copilotLoaded` is `false`, call `app.plugins.loadPlugin("copilot")` via
  `eval` and re-probe.)
- `buildTag` starts with the current worktree's short commit, reports the
  expected clean/dirty state, and stays unchanged until the next deployment
- `buildBranch` matches the worktree branch you actually built from. Multiple
  Conductor workspaces sharing one test vault means whichever ran
  `npm run test:vault` last wins — _verify_, don't assume.

### Failure modes to recognise

| Symptom                                                   | Cause                                                                                                    | Fix                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `Vault not found.`                                        | Typo in `vault=<name>` (case-sensitive, matches the vault name shown in `vaults verbose`)                | Run `$OBS vaults verbose` to list known vaults  |
| Command exits 0 with empty stdout, `eval` returns nothing | The named vault is registered but no renderer is open _yet_ — Obsidian is launching it. Retry after 1–2s | `sleep 2 && retry`, then verify                 |
| Default vault keeps changing between commands             | You omitted `vault=<name>` — focus moved                                                                 | Always pass the flag, never rely on the default |
| Screenshot shows a different vault than expected          | Same — captured the focused renderer, not the targeted one                                               | Re-take with `vault=<name>` explicit            |

## 1. Setup once per session

```bash
$OBS dev:debug on        # attach Chrome DevTools Protocol (required for dev:console, dev:errors, dev:cdp)
$OBS vault=$VAULT eval code='app.plugins.loadPlugin("copilot")'  # if not auto-loaded
```

`dev:debug on` is sticky for the life of the Obsidian process. Re-running it is
a no-op, but if Obsidian was restarted you need to run it again before
`dev:console`, `dev:errors`, or `dev:cdp` will return anything useful.

## 2. Driving the plugin

### Run a command

```bash
$OBS vault=$VAULT command id=copilot:agent-chat-open-window
```

The full set of registered command IDs is available via:

```bash
$OBS vault=$VAULT eval code='JSON.stringify(Object.keys(app.commands.commands).filter(c=>c.startsWith("copilot")))'
```

(Note: top-level `obsidian commands` lists only Obsidian-core commands. Plugin
commands are only visible through `app.commands.commands`.)

### Read or mutate settings programmatically

Settings live in `data.json` on disk and in a Jotai atom store at runtime. The
fastest, deterministic path for tests is to bypass the UI:

```bash
# Read
$OBS vault=$VAULT eval code='app.plugins.plugins.copilot.loadData().then(d=>JSON.stringify({temperature:d.temperature,defaultChainType:d.defaultChainType}))'

# Mutate and persist
$OBS vault=$VAULT eval code='(async()=>{
  const p=app.plugins.plugins.copilot;
  const d=await p.loadData();
  d.temperature=0.42;
  await p.saveData(d);
  return (await p.loadData()).temperature;
})()'
```

**Gotcha:** `saveData()` writes to disk but does **not** push into an already-open
settings modal's React state. If you need the UI to reflect the change, close
and re-open settings (`command id=app:open-settings`) or drive the change
through the UI itself (Section 4).

## 3. Capturing evidence

### Screenshot — `dev:screenshot`

```bash
$OBS vault=$VAULT dev:screenshot path=/tmp/before.png
sleep 1   # file is written asynchronously; the CLI returns before it lands on disk
```

Then read the PNG with the Read tool to inspect visually. Path can be absolute
(`/tmp/foo.png`) or vault-relative.

**Always pair the screenshot with a `vault=<name>` flag** — otherwise you may
capture whichever Obsidian window is focused, not the one under test. A useful
sanity check is to crop/inspect the status bar at the bottom which shows the
vault name.

### DOM query — `dev:dom`

Read-only — returns `outerHTML` (default), text, attributes, or computed CSS.

```bash
$OBS vault=$VAULT dev:dom selector='.vertical-tab-nav-item.is-active .vertical-tab-nav-item-title' text
$OBS vault=$VAULT dev:dom selector='.modal.mod-settings input[type="text"]' all
$OBS vault=$VAULT dev:dom selector='.copilot-chat-input' attr=placeholder
```

For complex inspection (loops, structured data), prefer `eval` with
`document.querySelectorAll` — `dev:dom` output gets verbose fast and the CLI
streams it back synchronously.

### Console & errors

```bash
$OBS vault=$VAULT dev:console limit=30
$OBS vault=$VAULT dev:console level=error limit=20
$OBS vault=$VAULT dev:errors clear   # reset before a scenario
$OBS vault=$VAULT dev:errors         # capture after
```

`dev:errors` only captures **uncaught** errors. Use the test pattern:
clear → run scenario → wait → re-read. Counts above zero mean a regression.

### Performance snapshots

```bash
$OBS vault=$VAULT dev:cdp method=Performance.enable
$OBS vault=$VAULT dev:cdp method=Performance.getMetrics      # JSHeap*, Nodes, JSEventListeners, ScriptDuration, ...
$OBS vault=$VAULT dev:cdp method=Memory.getDOMCounters       # { documents, jsEventListeners, nodes }
$OBS vault=$VAULT eval code='JSON.stringify(performance.memory)'
```

Action timing (two RAFs forces layout + paint commit):

```bash
$OBS vault=$VAULT eval code='(async()=>{
  const t0=performance.now();
  document.querySelector("[data-setting-id=\"copilot\"]").click();
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  return performance.now()-t0;
})()'
```

Diff-pattern for leak detection: snapshot `Memory.getDOMCounters` → repeat the
feature N times → snapshot again. If `nodes` or `jsEventListeners` keeps
climbing past N iterations, the feature is leaking.

## 4. Interacting with the UI (clicks, typing)

There is no first-class "click selector" or "type into input" CLI command.
Two real options:

### 4a. `eval` — synthetic JS events (fast, easy, slightly fake)

Works for most plugin UI:

```bash
# Click a button
$OBS vault=$VAULT eval code='document.querySelector(".send-button")?.click()'

# Set value on a React-controlled input
$OBS vault=$VAULT eval code='
  const el = document.querySelector(".copilot-chat-input");
  const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype,"value").set;
  setter.call(el, "hello");
  el.dispatchEvent(new Event("input",{bubbles:true}));
'
```

Caveats: synthetic events have `isTrusted=false`, so anything that gates on
that won't fire. Lexical / contentEditable surfaces usually need `beforeinput`,
not `input`.

### 4b. `dev:cdp` — real browser-level input (slower, faithful)

Use when synthetic events are rejected, when you need `isTrusted=true`, or
when you're verifying that the UI itself behaves correctly (focus, validators,
onChange, modals).

```bash
# Get target coordinates first
$OBS vault=$VAULT eval code='
  const el = document.querySelector("[data-setting-id=\"copilot\"]");
  const r  = el.getBoundingClientRect();
  JSON.stringify({x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)})
'

# Real click
$OBS vault=$VAULT dev:cdp method=Input.dispatchMouseEvent params='{"type":"mousePressed","x":174,"y":764,"button":"left","clickCount":1}'
$OBS vault=$VAULT dev:cdp method=Input.dispatchMouseEvent params='{"type":"mouseReleased","x":174,"y":764,"button":"left","clickCount":1}'

# Focus an input, then type via the browser input layer
$OBS vault=$VAULT eval code='document.querySelector(".copilot-chat-input").focus()'
$OBS vault=$VAULT dev:cdp method=Input.insertText params='{"text":"hello from cdp"}'
$OBS vault=$VAULT dev:cdp method=Input.dispatchKeyEvent params='{"type":"keyDown","key":"Enter","code":"Enter","windowsVirtualKeyCode":13}'
```

Verified end-to-end: a CDP `Input.insertText` into a settings field propagates
through the React onChange path and persists to `data.json`. The settings
modal's React state stays in sync (unlike the `saveData` path).

## 4c. Popout windows — the second targeting gotcha

Even after `vault=<name>` lands you on the correct renderer, Obsidian supports
**popout windows** (a view detached into its own Electron window). The CLI's
attach point is the main vault renderer only:

- `eval`'s `document` / `window` always refer to the main window.
- `dev:dom` and `dev:cdp Input.*` operate on the main window's document and
  input layer.
- `dev:screenshot` captures the main vault window — popout windows are not in
  the frame.

To reach a popout from the CLI, traverse `app.workspace.floatingSplit`:

```bash
$OBS vault=$VAULT eval code='JSON.stringify({
  popouts: app.workspace.floatingSplit?.children?.length || 0,
  popoutTypes: (app.workspace.floatingSplit?.children || []).map(c=>c.children?.[0]?.children?.[0]?.view?.getViewType?.())
})'
```

To query a popout's DOM, use the `.win` / `.doc` properties Obsidian augments
onto every node:

```bash
$OBS vault=$VAULT eval code='
  const popout = app.workspace.floatingSplit.children[0];
  const doc    = popout.win.document;
  doc.querySelector(".copilot-chat-input")?.value
'
```

For UI input into a popout, prefer `eval`-based synthetic events targeted at
`popout.win.document.querySelector(...)`. CDP-level `Input.*` events go to the
main window and won't reach the popout — there's no way around that with the
current CLI surface. **If your test scenario depends on popout interaction,
the cheap fix is to not pop the view out:** drive everything from the main
sidebar leaf.

Related runtime gotcha (in plugin code, not test code): standard `instanceof`
checks fail across realms — a popout window has its own `HTMLElement`,
`MouseEvent`, etc. constructors. Inside `eval`, use
`element.instanceOf(HTMLElement)` / `event.instanceOf(MouseEvent)` if you need
cross-realm type checks.

## 5. Vault data setup

For deterministic test fixtures, prefer creating notes via the CLI rather
than hand-editing the vault:

```bash
$OBS vault=$VAULT create name="test-note" content="# Hello\n\nbody"
$OBS vault=$VAULT append file="test-note" content="\nmore text"
$OBS vault=$VAULT delete file="test-note" permanent
$OBS vault=$VAULT search query="copilot" format=json limit=10
```

For more aggressive resets, manipulate files directly on disk under the vault
path (from `app.vault.adapter.basePath`) and then call
`$OBS vault=$VAULT reload` to make Obsidian re-scan.

## Component gallery workflow

Use the component gallery whenever a feature adds or changes a user-visible React component or a meaningful visual state. A story is not required for non-visual backend, data, or tooling changes. Gallery verification complements callable-level unit coverage; it does not replace it.

### Authoring stories

1. Add or update a `*.stories.tsx` file beside the component. The generated gallery index discovers `src/**/*.stories.tsx`; do not edit `dev/gallery/stories.generated.ts`.
2. Import `Meta` and `StoryObj` from `@/lib/story`, declare component metadata with `satisfies Meta<Props>`, and type every named story as `StoryObj<Props>`.
3. Cover the load-bearing states a user can actually see: default, empty, loading, success, error, disabled, overflow-prone content, or other states introduced by the feature. Use realistic copy and fixture props rather than production stores or runtime singletons.
4. Prefer `args` for ordinary prop states and `render` for compositions. Hook-backed render functions are supported. Keep fixtures deterministic and actions inert unless interaction is the behavior under test.
5. Choose `parameters.gallery.host` (`leaf`, `modal`, `popover`, or `settings-tab`) and `layout` (`padded`, `centered`, or `fullscreen`) to match the real component boundary. Use `coverage: false` only for an intentional presentational-component opt-out. Stories cannot pin a canvas width — width is view state owned by the gallery's width toolbar, so check a component at other widths with that toolbar or sweep them all via `audit()`. Never add a story whose only difference from a sibling is the width you wish it rendered at; it will render identically.
6. If a component cannot render without plugin state, extract or expose a presentational boundary that accepts the required data as props; do not widen the Gallery import fence to reach settings, stores, or runtime singletons.

A minimal adjacent story looks like this:

```tsx
import type { Meta, StoryObj } from "@/lib/story";
import { StatusCard, type StatusCardProps } from "./StatusCard";

const meta = {
  title: "Feature/Status Card",
  component: StatusCard,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<StatusCardProps>;
export default meta;

export const Error: StoryObj<StatusCardProps> = {
  args: { message: "The operation could not be completed.", tone: "error" },
};
```

Before live verification, run the focused unit tests for the changed component and story contract, then build the development plugin:

```bash
npm run gallery:build
```

Deploy to the non-production test vault configured by `COPILOT_TEST_VAULT_PATH` with `npm run gallery:vault`. Before any CLI or UI mutation, verify that the resolved vault name and path match that configuration; never rely on the implicitly focused renderer.

### The gallery shares a stylesheet with the plugin

The gallery's stylesheet is built by concatenating `src/styles/tailwind.css` into its own source, so it carries a near-complete copy of the production stylesheet — and Obsidian injects every enabled plugin's `styles.css` document-wide. Both copies land in the same cascade at equal specificity, so a gallery copy built from an older `src/styles/tailwind.css` outranks the deployed production rules and the plugin's own views render pre-change behavior.

`npm run test:vault` keeps the two in step: when the vault's gallery plugin resolves to the worktree being deployed, it rebuilds and reloads the gallery too. It cannot do that when the deployed gallery belongs to a different worktree — `gallery:vault` symlinks its whole source directory, so the live stylesheet is owned by whichever worktree deployed it last. In that case the deployment warns and names the owning path; run `npm run gallery:vault` from that worktree or disable the gallery plugin while testing.

If a CSS change appears to have no effect, check for the same selector twice in the inspector before suspecting the change itself.

The story tree keeps its top-level categories open. Select a category label to show its contact sheet. For nested categories, the label also folds or unfolds the subtree; use the adjacent chevron when you want to toggle it without changing the selected contact sheet. Selecting a different story or contact sheet does not close branches you already opened.

### Agent verification loop

When the development-only component gallery plugin is loaded, its typed
`window.__gallery` handle can select and audit stories without screenshots.
Short async calls can set both `awaitPromise` and `returnByValue`. For a full
audit, store the eventual result in the page and poll it: the Obsidian CLI can
return before a long-running CDP promise settles even when `awaitPromise` is
set.

```bash
# Discover exact story ids.
$OBS vault=$VAULT dev:cdp method=Runtime.evaluate params='{"expression":"window.__gallery.list()","returnByValue":true}'

# Render one story and wait until its effects and layout have settled.
$OBS vault=$VAULT dev:cdp method=Runtime.evaluate params='{"expression":"window.__gallery.show(\"UI/Button/Variants\",{width:300}).then(()=>true)","awaitPromise":true,"returnByValue":true}'

# Address the mounted case by its stable identity and requested width.
$OBS vault=$VAULT dev:dom selector='[data-story="UI/Button/Variants"][data-story-width="300"]' all

# Start an exact width sweep without relying on the CLI connection to await it.
$OBS vault=$VAULT dev:cdp method=Runtime.evaluate params='{"expression":"window.__galleryRun={status:\"pending\"};window.__gallery.audit({widths:[300,340,400,600]}).then(value=>{window.__galleryRun={status:\"fulfilled\",value}},reason=>{window.__galleryRun={status:\"rejected\",reason:String(reason?.stack??reason)}});true","returnByValue":true}'

# Repeat until status is fulfilled or rejected. A fulfilled value has one AuditReport per width.
$OBS vault=$VAULT dev:cdp method=Runtime.evaluate params='{"expression":"window.__galleryRun","returnByValue":true}'
```

`audit()` returns an array shaped as
`[{theme,width,findings:[{story,check,detail}]}]`. Requested widths may be any
positive finite pixel values; the four values above match the gallery's visible
buttons. Theme is intentionally read-only through this handle: switch the
Obsidian appearance setting, then run the same array sweep again. A complete
automated pass ends by checking uncaught errors separately:

```bash
$OBS vault=$VAULT dev:errors clear
# Run the store-and-poll sweep above and wait for a fulfilled or rejected status.
$OBS vault=$VAULT dev:errors
```

## 6. Typical e2e flow

A minimal smoke-test scaffold:

```bash
OBS=/Applications/Obsidian.app/Contents/MacOS/obsidian
VAULT="$(basename "$COPILOT_TEST_VAULT_PATH")"

# 1. Preflight — verify target + build
$OBS vault=$VAULT eval code='JSON.stringify({
  v: app.vault.getName(),
  loaded: !!app.plugins.plugins.copilot,
  ver: app.plugins.manifests.copilot?.version
})' || exit 1

# 2. Attach debugger, clear error buffer
$OBS vault=$VAULT dev:debug on
$OBS vault=$VAULT dev:errors clear

# 3. Baseline screenshot + metrics
$OBS vault=$VAULT dev:screenshot path=/tmp/test-before.png
$OBS vault=$VAULT dev:cdp method=Memory.getDOMCounters > /tmp/dom-before.json

# 4. Run the scenario
$OBS vault=$VAULT command id=copilot:agent-chat-open-window
sleep 1
$OBS vault=$VAULT eval code='document.querySelector(".copilot-chat-input")?.focus()'
$OBS vault=$VAULT dev:cdp method=Input.insertText params='{"text":"test prompt"}'

# 5. Capture evidence
sleep 2
$OBS vault=$VAULT dev:screenshot path=/tmp/test-after.png
$OBS vault=$VAULT dev:cdp method=Memory.getDOMCounters > /tmp/dom-after.json
$OBS vault=$VAULT dev:console level=error limit=20 > /tmp/console-errors.txt
$OBS vault=$VAULT dev:errors > /tmp/uncaught.txt

# 6. Assert: errors empty, screenshots look right, node counts not blown up
```

## 7. Quick reference

| Need                               | Command                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| List open vaults                   | `vaults verbose`                                                                                                                    |
| Target a vault                     | prefix every command with `vault=<name>`                                                                                            |
| Verify the right vault is targeted | `vault=<name> eval code='app.vault.getName()'`                                                                                      |
| Visual confirmation                | `vault=<name> dev:screenshot path=/tmp/x.png` (sleep ≥1s before reading)                                                            |
| Load plugin if not loaded          | `vault=<name> eval code='app.plugins.loadPlugin("copilot")'`                                                                        |
| List plugin commands               | `vault=<name> eval code='JSON.stringify(Object.keys(app.commands.commands).filter(c=>c.startsWith("copilot")))'`                    |
| Run a plugin command               | `vault=<name> command id=copilot:<id>`                                                                                              |
| Read settings (disk)               | `vault=<name> eval code='app.plugins.plugins.copilot.loadData().then(JSON.stringify)'`                                              |
| Mutate settings (disk)             | `vault=<name> eval code='(async()=>{const p=app.plugins.plugins.copilot;const d=await p.loadData();d.X=Y;await p.saveData(d);})()'` |
| Click via JS                       | `vault=<name> eval code='document.querySelector("...").click()'`                                                                    |
| Click via CDP                      | `dev:cdp method=Input.dispatchMouseEvent params='{"type":"mousePressed",...}'`                                                      |
| Type via CDP                       | `dev:cdp method=Input.insertText params='{"text":"..."}'`                                                                           |
| Uncaught errors                    | `dev:errors` (clear + run + read)                                                                                                   |
| Console messages                   | `dev:console level=error limit=20`                                                                                                  |
| DOM scale                          | `dev:cdp method=Memory.getDOMCounters`                                                                                              |
| Heap                               | `eval code='JSON.stringify(performance.memory)'`                                                                                    |
| Full perf metrics                  | `dev:cdp method=Performance.getMetrics` (after `Performance.enable`)                                                                |
