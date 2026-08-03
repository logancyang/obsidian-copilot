# Component Gallery — Implementation Plan

Suggested location: `designdocs/gallery-bootstrap.md`

<!-- gallery-progress-ledger:start -->

## Progress ledger

| Step | Status   | Branch / PR                                   | Verification evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---: | -------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|    0 | COMPLETE | `codex/gallery-bootstrap-step-0` / [PR #2725](https://github.com/logancyang/obsidian-copilot/pull/2725) | PASS: build; 7 focused suites / 54 tests; full unit suite; full lint; forbidden value-import probe rejected and type-only probe accepted; import grep clean; production artifacts unchanged. Live Obsidian: exact `codex/gallery-bootstrap-step-0` build loaded in `copilot-test-vault`; classic chat and the model selector rendered, and the selector menu opened with its model list. `consistent-type-imports` is scoped to `src/components/ui` because global enablement exposed 751 unrelated current-base violations. |
|    1 | COMPLETE | `codex/gallery-bootstrap-step-1` / [PR #2726](https://github.com/logancyang/obsidian-copilot/pull/2726) | PASS: gallery build; 1 focused suite / 6 tests; full unit suite (367 suites / 5,234 tests); format; lint; production build; gallery bundle has no LangChain import; production artifacts unchanged. Live Obsidian: gallery deployed and reloaded only in `copilot-test-vault`; manifest, loaded/enabled state, command, and one gallery leaf verified; gallery rendered `Gallery: 0 stories`; production Copilot Chat still rendered with the `Copilot Plus Flash` model control and Send button. Adaptations: omit `onunload()` leaf detachment because `obsidianmd/detach-leaves` preserves moved leaves; refresh manifests before safe disable/re-enable so first installs are discovered and enabled state is saved. |
|    2 | COMPLETE | `codex/gallery-bootstrap-step-2` / [PR #2727](https://github.com/logancyang/obsidian-copilot/pull/2727) | PASS automated: gallery/CSS builds; focused gallery suite (1 suite / 7 tests); full unit suite (367 suites / 5,235 tests); format; lint; production build; no LangChain in gallery bundle; both scoped selectors and every gallery wrapper utility present; production TypeScript entry surface unchanged; diff check; imported spec body byte-identical. Live Obsidian, only in `copilot-test-vault`: 35 Buttons rendered beside working Copilot Chat; gallery default and production Copilot Save Buttons had identical classes and zero computed-style differences for background, foreground, radius, 36px height, padding, font, shadow, and line height in default dark, default light, Things light, and Things dark; real hover background/foreground/radius/shadow also matched. Screenshots: `step-2-default-dark.png`, `step-2-default-light.png`, `step-2-things-light.png`; test-vault appearance restored exactly. Adaptations: use an unambiguous 7 variants × 5 sizes matrix; use the native Copilot modal's normal-size primary Button for exact comparison because Chat's visible Send Button intentionally overrides size/radius; keep Tailwind content config unchanged because required utilities are present and widening it would change production CSS beyond this step's selectors. |
|    3 | COMPLETE | `codex/gallery-bootstrap-step-3` / [PR #2728](https://github.com/logancyang/obsidian-copilot/pull/2728) | PASS automated: gallery/CSS build; focused gallery suite (1 suite / 9 tests); full unit suite (367 suites / 5,236 tests); format; lint; clean TypeScript check; production build; gallery bundle has no LangChain marker; production bundle has no gallery/story marker; production entry surface unchanged; fourth named-export auto-render and grouped-count probes passed without a gallery edit; forbidden `decorators` / `play` probes failed at their declarations; declarations-only AST check; diff check; imported spec body byte-identical. Live Obsidian, only in `copilot-test-vault`: `UI / Button`, `3 stories`, and `Disabled` / `Sizes` / `Variants` rendered with merged metadata beside working Copilot Chat; a temporary fourth named export appeared live while renderer/index SHA-256 values stayed unchanged, then the probe was removed and the final three-story bundle reloaded. Screenshot: `step-3-button-stories.png`. Adaptations: fail a malformed story explicitly when neither `render` nor `meta.component` is defined; render each module under a human-readable `meta.title` with its computed story count after live review showed export names alone were ambiguous. Selection remains the dedicated Step 6 milestone; only Button exists at this stage. |
|    4 | COMPLETE | `codex/gallery-bootstrap-step-4` / [PR #2729](https://github.com/logancyang/obsidian-copilot/pull/2729) | PASS automated: generated gallery/CSS build; 2 focused suites / 12 tests; full unit suite (368 suites / 5,240 tests); format; lint; clean TypeScript; production build from a missing-generated-file state; gallery bundle has no LangChain marker; production bundle has no gallery/story marker; diff check; imported spec body byte-identical. Generator determinism, nested/path handling, exact four-root counting, exclusions, wired-story bonus handling, and meta-level coverage opt-out are covered. Live Obsidian, only in `copilot-test-vault`: the temporary `AgentWelcomeCard.stories.tsx` probe appeared under `Agent Mode / Agent Welcome Card` with no index edit and changed coverage 1 → 2; deleting it restored `97 presentational components · 1 with stories · 96 missing`, `UI / Button`, and its three stories with no probe residue while production Copilot Chat remained live. Screenshot: `step-4-generated-index.png`. Adaptations: the current stacked branch contains 97 presentational components rather than the source plan's 96 snapshot; a tracked declaration plus virtual Jest mock keeps clean-checkout TypeScript/tests valid while the generated runtime index remains ignored; combined root results are deduplicated. Selection remains the dedicated Step 6 milestone and must visibly expose the component list, current selection, and switching action. |
|    5 | IN PROGRESS | `codex/gallery-bootstrap-step-5` / —          | PASS automated: a missing generated index was recreated before `gallery:dev` started; temporary story-label and Tailwind-utility edits rebuilt the gallery JS and CSS watchers, then were removed without source or artifact residue; gallery build; gallery-only deploy fixture; 3 focused suites / 13 tests; full unit suite (369 suites / 5,241 tests); format; lint; production build; shell syntax; gallery bundle has no LangChain marker; production bundle has no gallery/story marker; production artifacts and TypeScript entry are unchanged; diff check; imported spec body byte-identical. Adaptations: named `gallery:stories` and `gallery:esbuild` scripts keep build/dev wiring shared; Tailwind uses its supported polling watch because native filesystem events did not fire in the sandbox; gallery deployment creates and preserves `.hotreload` without changing gallery data, community-plugin state, or production Copilot state in the fixture. Awaiting orchestrator vault-pinned live Hot Reload validation; this step did not access a vault or GUI. |
|    6 | PENDING  | —                                             | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
|    7 | PENDING  | —                                             | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
|    8 | PENDING  | —                                             | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
|    9 | PENDING  | —                                             | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
|   10 | PENDING  | —                                             | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

<!-- gallery-progress-ledger:end -->

## Objective

Build a development-only Obsidian plugin that renders every UI primitive in
`src/components/ui` across its states, at full fidelity, inside a real Obsidian leaf.

It serves three purposes, in increasing order of value:

1. **Develop and verify components without clicking through the real plugin.** Reaching a
   given component in the running app costs minutes; reaching it here costs nothing.

2. **Make hard-to-reproduce states testable.** Error states, empty states, rate-limited
   states, missing-key states, missing-CLI states, and loading states are skipped in
   practice — not out of laziness, but because reproducing them requires breaking something
   real. A story reaches them for free, which is the difference between "we should check
   that" and "that is checked."

3. **Give agents a render target they can drive and inspect.** The repo already has an
   Obsidian CLI with CDP attached (`dev:dom`, `dev:screenshot`, `dev:console`, `dev:errors`,
   `dev:cdp` — see `designdocs/agents/TESTING_GUIDE.md`). With stable selectors and
   externally settable state, an agent can render any story in any theme at any width and
   assert on the result without a human looking at anything.

There is a fourth effect, structural rather than functional: **a component that cannot
render in the gallery is telling you it crossed an architectural boundary.** The gallery
makes coupling to plugin state visible at the moment it is introduced, rather than years
later when someone tries to reuse or test the component. Treat a story that will not render
as a design defect in the component, not an inconvenience in the harness.

## Context an implementer needs

- **Repo:** `logancyang/obsidian-copilot`. Target branch: `v4-preview`.
- **Stack:** React 18, TypeScript 5.7, Tailwind 3.4 (prefix `tw-`, `preflight: false`),
  shadcn/ui + Radix + CVA, esbuild, path alias `@/*` → `src/*`.
- **Presentational surface:** the repo already separates presentational UI into `*/ui/`
  directories — `src/components/ui` (39), `src/agentMode/ui` (45), `src/modelManagement/ui`
  (6), `src/agentMode/skills/ui` (6) = **96 files**. A further 156 `.tsx` files live outside
  them and are wired/feature components. Stories are expected for `**/ui/**`; elsewhere they
  are optional and indicate a presentational split worth encouraging.
- **Host variety:** 22 classes extend Obsidian's `Modal`. `src/components/modals/ReactModal.tsx`
  is an existing generic React-in-Modal wrapper the gallery reuses.
- One component — `ModelSelector` — reads the settings singleton at render; Step 0 fixes it.
- **Build today:** `src/main.ts` → `main.js` via `esbuild.config.mjs`;
  `src/styles/tailwind.css` → `styles.css` via the Tailwind CLI.
- **Test vault install:** `scripts/test-vault.sh`, driven by the `COPILOT_TEST_VAULT_PATH`
  environment variable.

## Why an Obsidian plugin and not Storybook

Storybook renders in a browser tab. These components are styled substantially by Obsidian
itself, so a browser tab shows something that looks plausible and is wrong:

- `corePlugins: { preflight: false }` is set deliberately, so bare `button`, `input`,
  `select`, and `textarea` elements inherit their appearance from Obsidian's `app.css`.
  Without it they fall back to browser defaults.
- The active theme — including community themes — overrides both CSS variables and rules.
- `src/styles/tailwind.css` contains selectors rooted at real leaf ancestry, e.g.
  `.workspace-leaf-content[data-type="copilot-chat-view"] .view-content`, which never
  matches outside Obsidian.

Rendering inside a real Obsidian leaf removes the fidelity question entirely: there is
nothing to reconstruct, and switching themes is a settings toggle.

**Storybook's Component Story Format *is* used — a strict, typed subset of CSF3.** Story
files are valid CSF3 today; the gallery simply implements a small part of the spec.

The governing principle: **omitting a CSF field is always forward-compatible; adding a
non-CSF field is the only thing that creates migration debt.** So gallery-specific settings
(`host`, `layout`, `width`, `coverage`) live inside CSF's `parameters` under a `gallery`
namespace — an open bag that Storybook ignores unless an addon claims it — rather than as
invented top-level properties.

Supported: `title`, `component`, `args`, `render`, `name`, `parameters`.
Excluded by type: `decorators`, `argTypes`, `play`, `loaders`, `beforeEach`, `globals`,
`tags`, `subcomponents`, `includeStories`, `excludeStories`.

Every exclusion is an omission, so adopting real Storybook later is `npm i -D storybook`, a
`.storybook/main.ts` pointed at the same glob, and an import-path change — not a rewrite.

## Constraints

- **Production `main.js` must be byte-identical.** No gating flags, no dead code, no
  imports added to `src/main.ts`. Isolation is a build boundary, not a runtime check.
- The gallery is never wired into CI. It is a human verification surface.
- Exactly one production-side change is permitted, in Step 2, and it is CSS-only.

## Out of scope

Storybook's dev server, MCP servers, visual regression testing, CI integration, and
refactoring components to remove plugin coupling.

---

## Step 0 — Decouple `src/components/ui` from plugin state

**Goal.** Make every primitive renderable without booting the plugin. Do this first: it is
small, it is correct independently of the gallery, and skipping it means discovering the
problem halfway through Step 3.

### What is actually coupled

Grepping import paths overstates this. Measured against the code:

| Component | Import | Real coupling |
|---|---|---|
| `ModePicker.tsx` | `CopilotMode` from `@/agentMode` | **None** — type-only, erased at compile time |
| `model-display.tsx` | `CustomModel`, `getProviderLabel`, `ModelCapability` | **None** — a type, a pure function, a constant |
| `ModelEffortPicker.tsx` | `getModelKeyFromModel` from `@/settings/model` | **None at render** — pure derivation |
| `ModelSelector.tsx` | `useSettingsValue()` at line 89 | **Yes** — reads the settings singleton at render |

The subtler problem is **import-time side effects**. `src/settings/model.ts` runs
`createStore()` and `atom(DEFAULT_SETTINGS)` at module scope, so importing even a pure
helper from it instantiates a Jotai store. `@/aiParams` imports
`@langchain/core/language_models/chat_models` at the top, so a value import from there pulls
LangChain into the bundle. Today esbuild elides these because the bindings are only used in
type position — that is inference, not a guarantee, and it breaks silently the first time
one is used as a value.

### Changes

**1. Lift the settings read out of `ModelSelector`.** Replace `const settings =
useSettingsValue()` with props for the fields it consumes; move the call to the caller.

**2. Make type-only imports explicit** across all four components — `import type { … }` —
and enable `@typescript-eslint/consistent-type-imports` so it stays that way.

**3. Extract the pure helpers into `@/lib`.** Two barrels are the problem:

- `@/settings/model` runs `createStore()` at module scope.
- `@/utils` has **value-position imports of `@langchain/core`** (lines 21–22), so anything
  importing from it risks pulling LangChain into the bundle.

The helpers `ui/` actually uses from them are already pure — `getProviderLabel` reads a
constant map, `checkModelApiKey(model, settings)` takes settings as a parameter rather than
reading them, and `getModelKeyFromModel` is a plain derivation. Move them:

| Move | From | To |
|---|---|---|
| `getModelKeyFromModel` | `@/settings/model` | `src/lib/model-key.ts` |
| `getProviderLabel`, `err2String`, `checkModelApiKey` | `@/utils` | `src/lib/model-display-utils.ts` |
| `urlTagUtils` helpers | `@/utils/urlTagUtils` | `src/lib/url-tag.ts` |

Re-export from the original modules so no call site outside `ui/` has to change. Do this as
its own commit — it touches files well beyond `src/components/ui` and should be trivially
isolable.

**4. Enforce the boundary in lint, so it holds.** Without this, Step 0 is a cleanup that
decays. Add to `eslint.config.mjs`, alongside the existing `createRoot` guardrail:

```js
{
  files: ["src/components/ui/**/*.{ts,tsx}"],
  // Tests may reach further; stories deliberately may not — a story that needs
  // plugin state to build a fixture is reporting a coupled component.
  ignores: ["src/components/ui/**/*.test.{ts,tsx}"],
  rules: {
    "@typescript-eslint/no-restricted-imports": ["error", {
      patterns: [{
        // Allowlist, not denylist: almost every src/ directory holds a store or
        // singleton somewhere, so enumerating the bad ones will always lag.
        group: ["@/*", "!@/components/ui/*", "!@/lib/*", "!@/constants"],
        allowTypeImports: true,
        message:
          "src/components/ui must not import values outside @/components/ui, @/lib, " +
          "and @/constants. Type-only imports are always fine. If a primitive needs " +
          "plugin state, take it as a prop; if it needs a helper, move the helper to " +
          "@/lib. Reaching into @/settings, @/aiParams, @/utils, or @/agentMode couples " +
          "a presentational component to the plugin runtime and makes it unrenderable " +
          "and untestable in isolation.",
      }],
    }],
  },
}
```

Two notes on scope. `@/constants` is verified free of module-level side effects, which is
why it is allowed. And ESLint only sees **direct** imports — if a `@/lib` module later
grows a store dependency, this rule will not catch it. The bundle assertion in the
verification below is the transitive backstop.

### Deliverable

All 39 non-test files in `src/components/ui` are renderable without plugin state, and a
lint rule prevents regression.

### Verify

1. `npm run build` succeeds and the plugin still works in the test vault — `ModelSelector`
   behaves identically at its call sites.
2. `npm test` passes.
3. No file in `src/components/ui` contains a value import from `@/settings`, `@/aiParams`,
   `@/agentMode`, `@/state`, or `@/LLMProviders`:

   ```bash
   grep -nE '^import \{[^}]*\} from "@/(settings|aiParams|agentMode|state|LLMProviders)' \
     src/components/ui/*.tsx | grep -v '^.*import type'
   ```

   Expect no output.
4. The lint rule fires. Add `import { getSettings } from "@/settings/model";` to any file
   in `src/components/ui` → `npm run lint` fails with the custom message. Change it to
   `import type { CopilotSettings } from "@/settings/model";` → lint passes, confirming
   `allowTypeImports` works. Remove both.
5. `npm run lint` passes clean across the whole repo with the new rule enabled — this is the
   real proof that parts 1–3 are complete.
6. Transitive backstop: after Step 1, `grep -c "langchain" dev/gallery/main.js` returns 0.
   ESLint cannot see through `@/lib`; the bundle can.

---

## Step 1 — A gallery plugin that loads and does nothing

**Goal.** Prove the build, install, and view registration work in isolation, before any
component is involved. Debugging five things at once is the main way this stalls.

### Files

```
dev/gallery/manifest.json
dev/gallery/main.ts
dev/gallery/esbuild.config.mjs
dev/gallery/.gitignore          →  main.js, styles.css
scripts/gallery-vault.sh
```

`dev/gallery/manifest.json`:

```json
{
  "id": "copilot-component-gallery",
  "name": "Copilot Component Gallery (dev)",
  "version": "0.0.1",
  "minAppVersion": "1.11.4",
  "isDesktopOnly": false,
  "description": "Development-only gallery for Copilot UI primitives. Not for distribution.",
  "author": "Logan Yang"
}
```

`dev/gallery/main.ts`:

```ts
import { ItemView, Plugin, WorkspaceLeaf } from "obsidian";

export const GALLERY_VIEWTYPE = "copilot-component-gallery";

class GalleryView extends ItemView {
  getViewType() { return GALLERY_VIEWTYPE; }
  getDisplayText() { return "Component gallery"; }
  getIcon() { return "layout-grid"; }

  async onOpen() {
    this.containerEl.children[1].setText("Gallery: 0 stories");
  }
}

export default class GalleryPlugin extends Plugin {
  async onload() {
    this.registerView(GALLERY_VIEWTYPE, (leaf: WorkspaceLeaf) => new GalleryView(leaf));
    this.addCommand({
      id: "open-component-gallery",
      name: "Open component gallery",
      callback: async () => {
        const leaf = this.app.workspace.getLeaf("tab");
        await leaf.setViewState({ type: GALLERY_VIEWTYPE, active: true });
        this.app.workspace.revealLeaf(leaf);
      },
    });
  }
  onunload() { this.app.workspace.detachLeavesOfType(GALLERY_VIEWTYPE); }
}
```

`dev/gallery/esbuild.config.mjs` — a stripped copy of the root config. Keep
`format: "cjs"`, `target: "es2020"`, `define: { global: "window" }`,
`external: ["obsidian", "electron"]`, `outfile: "dev/gallery/main.js"`. Drop the svgr, wasm,
and node-shim plugins: no primitive in `src/components/ui` imports `.svg`, and none needs
Node builtins. esbuild picks up the `@/*` → `src/*` alias from the root `tsconfig.json`
automatically.

`scripts/gallery-vault.sh` — copy `scripts/test-vault.sh`, change the destination to
`$COPILOT_TEST_VAULT_PATH/.obsidian/plugins/copilot-component-gallery/` and symlink
`dev/gallery/{main.js,manifest.json,styles.css}`. Keep its existing guards
(`COPILOT_TEST_VAULT_PATH` set, `.obsidian` exists, worktree not inside the vault).

`package.json`:

```json
"gallery:build": "node dev/gallery/esbuild.config.mjs production",
"gallery:vault": "npm run gallery:build && bash scripts/gallery-vault.sh"
```

### Deliverable

A second plugin installable into the test vault.

### Verify

1. `npm run gallery:vault` succeeds.
2. Obsidian → Settings → Community plugins shows **Copilot Component Gallery (dev)** as a
   separate entry from Copilot. Enable it.
3. Command palette → "Open component gallery" opens a tab reading `Gallery: 0 stories`.
4. `git status` shows no modification to `main.js`, `src/main.ts`, or `manifest.json`.
5. Copilot itself still loads and works with the gallery enabled.

**Stop here if any of these fail.** Everything downstream assumes this works.

---

## Step 2 — CSS, and the fidelity gate

**Goal.** Prove a component rendered in the gallery is visually identical to the same
component in the Copilot pane. This is the entire justification for the approach; if it
fails, nothing built on top is trustworthy.

### Changes

**1. Build the stylesheet into the gallery** — same source, second output:

```json
"gallery:css": "npx tailwindcss -i src/styles/tailwind.css -o dev/gallery/styles.css",
"gallery:build": "npm run gallery:css && node dev/gallery/esbuild.config.mjs production",
```

**2. Add the gallery's view type to the scoped selectors** in `src/styles/tailwind.css`.
Two selector lists are rooted at `.workspace-leaf-content[data-type="copilot-chat-view"]`.
Add `[data-type="copilot-component-gallery"]` to each. **This is the only production-side
diff in this plan** — CSS-only, inert in production because that view type never exists
there.

**3. Render one component.** Mount React in the view and render `Button` across all seven
variants (`default`, `destructive`, `secondary`, `ghost`, `link`, `success`, `ghost2`) and
all five sizes (`default`, `sm`, `lg`, `icon`, `fit`).

### Deliverable

The gallery shows a row of buttons.

### Verify — this is the gate

1. Open the gallery in one tab and the Copilot chat pane in another, side by side.
2. A `variant="default"` button in the gallery is **visually identical** to a primary button
   in the chat pane — same background, radius, height, padding, font, hover state.
   Screenshot both and flip between them if unsure.
3. Switch Obsidian to default light. Both change together and still match.
4. Install one community theme (Minimal or Things). Both change together and still match.

**If they do not match, stop and diagnose before Step 3.** The likely cause is a scoped
selector missed in change 2. Run `getComputedStyle` on both buttons in devtools and diff the
properties.

---

## Step 3 — CSF3 subset, one story file, explicit index

**Goal.** Move state definitions next to the components using a strict subset of CSF3 —
valid Storybook files, rendered by ~5 lines of our own code. No codegen yet; an explicit
index keeps the moving parts visible while the render path is being proven.

### The types

`src/lib/story.ts` — deliberately in `src/`, not `dev/gallery/`, so story files never
reference the dev tree:

```ts
import type { ComponentType, ReactNode } from "react";

export type Host = "leaf" | "modal" | "popover" | "settings-tab";
export type Layout = "padded" | "centered" | "fullscreen";

/** Namespaced so it can never collide with a real Storybook addon's parameters. */
export interface GalleryParameters {
  gallery?: { host?: Host; layout?: Layout; width?: number; coverage?: boolean };
}

/** Strict subset of CSF3 ComponentAnnotations. */
export interface Meta<P = unknown> {
  title: string;
  component?: ComponentType<P>;
  args?: Partial<P>;
  parameters?: GalleryParameters;
}

/** Strict subset of CSF3 StoryAnnotations. */
export interface StoryObj<P = unknown> {
  name?: string;
  args?: Partial<P>;
  render?: (args: P) => ReactNode;
  parameters?: GalleryParameters;
}
```

Type names match Storybook's exports exactly, so migration is a change of import path.

### What is excluded, and why each exclusion is safe

| Excluded | Do this instead | Forward-compatible because |
|---|---|---|
| `decorators` | wrap inside `render` with `<GalleryProviders>` | adding decorator support later is additive |
| `argTypes` | — | only meaningful with a controls UI |
| `play` | Jest + RTL | additive |
| `loaders`, `beforeEach`, `globals`, `tags` | — | unused |
| `subcomponents`, `includeStories`, `excludeStories` | — | unused |

`satisfies Meta<…>` gives excess-property checking, so writing `decorators` or `play` is a
compile error at the point of writing. That is the enforcement — not a convention.

**Optionally stronger:** type against `@storybook/csf`'s canonical `ComponentAnnotations` /
`StoryAnnotations` and derive the subset with `Pick`. Types-only devDependency, no runtime,
no bundle impact — it turns "this is really CSF3" from an assertion into a compiler
guarantee. Verify that package's current export surface before adopting it; the hand-written
types above are the safe default.

### Example

`src/components/ui/button.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "@/lib/story";
import { Button, type ButtonProps } from "./button";

const VARIANTS = ["default","destructive","secondary","ghost","link","success","ghost2"] as const;
const SIZES = ["default","sm","lg","icon","fit"] as const;

const meta = { title: "UI/Button", component: Button } satisfies Meta<ButtonProps>;
export default meta;

export const Disabled: StoryObj<ButtonProps> = {
  args: { disabled: true, children: "Working…" },
};

export const Variants: StoryObj<ButtonProps> = {
  render: () => (
    <div className="tw-flex tw-flex-wrap tw-gap-2">
      {VARIANTS.map(v => <Button key={v} variant={v}>{v}</Button>)}
    </div>
  ),
};

export const Sizes: StoryObj<ButtonProps> = {
  render: () => (
    <div className="tw-flex tw-items-center tw-gap-2">
      {SIZES.map(s => <Button key={s} size={s}>{s}</Button>)}
    </div>
  ),
};
```

`title` uses `/` as a hierarchy separator; the Step 6 sidebar tree is derived from it, so
pick titles deliberately.

### The renderer — CSF3's own semantics, in five lines

```tsx
const story = mod[exportName] as StoryObj<any>;
const meta  = mod.default as Meta<any>;
const args  = { ...meta.args, ...story.args };
const gal   = { ...meta.parameters?.gallery, ...story.parameters?.gallery };

const node = story.render ? story.render(args) : <meta.component {...args} />;
```

`gal.host` and `gal.layout` drive Steps 6 and 7. There is nothing else to interpret.

### Index

`dev/gallery/stories.ts` — hand-written at this step:

```ts
export const modules = {
  button: () => import("@/components/ui/button.stories"),
};
```

### Deliverable

Story files that are valid CSF3, rendered without a story library.

### Verify

1. The gallery shows three stories for Button — `Disabled`, `Variants`, `Sizes` — each
   labelled with its export name.
2. Add a fourth named export, rebuild — it appears without touching any gallery file.
3. Add `decorators: []` to the meta → **compile error**. Add `play: async () => {}` to a
   story → **compile error**. Remove both. This is the subset being enforced.
4. `src/lib/story.ts` contains type declarations only — no runtime code at all. If a
   `compose`, `apply`, or `merge` function has appeared, the subset is becoming a framework;
   stop and reconsider.

---

## Step 4 — Generate the index, and report coverage

**Goal.** Remove the hand-maintained index, which is a silent-failure surface: a forgotten
registration means a component is simply absent, and absence does not look like an error.

### Changes

`scripts/gen-gallery-stories.mjs` — glob `src/**/*.stories.tsx` (not just
`src/components/ui`), write
`dev/gallery/stories.generated.ts` with one dynamic import per file. Run it in
`gallery:build` ahead of esbuild. Gitignore the generated file.

Render a coverage line at the top of the gallery:

```
96 presentational components · 12 with stories · 84 missing
```

Compute the denominator from files under `**/ui/**` — `src/components/ui`,
`src/agentMode/ui`, `src/modelManagement/ui`, `src/agentMode/skills/ui` — excluding
`*.test.tsx` and `*.stories.tsx`. Components outside those directories are wired and are
**not** counted; a story for one of them is a bonus, not an obligation. Support `parameters: { gallery: { coverage: false } }` on a meta to opt its component out
rather than arguing with the number.

### Deliverable

Adding a `*.stories.tsx` file is the only step needed to get a component into the gallery.

### Verify

1. Create `src/agentMode/ui/AgentWelcomeCard.stories.tsx` with a single trivial export, run
   `npm run gallery:build` — it appears under its own tree node, no index file edited. This also proves the glob reaches outside `src/components/ui`.
2. The coverage line increments from 1 to 2.
3. Delete the file, rebuild — coverage returns to 1 and the count is correct.

---

## Step 5 — The edit-see loop

**Goal.** Make iteration fast enough that story-first development is pleasant. Without this,
the gallery gets abandoned within a week.

### Changes

```json
"gallery:dev": "run-p \"gallery:css -- --watch\" \"gallery:esbuild -- --watch\""
```

Install the community **Hot Reload** plugin in the test vault and create a `.hotreload` file
inside `.obsidian/plugins/copilot-component-gallery/`. It watches `main.js` and reloads the
plugin automatically on change.

### Deliverable

Edit a story, see it in Obsidian without running anything.

### Verify

1. Run `npm run gallery:dev`.
2. Change a button label in `button.stories.tsx`, save.
3. The gallery tab reflects the change within a few seconds — no terminal command, no manual
   plugin toggle.
4. Change a Tailwind class in the same story. It also updates, confirming the CSS watch is
   wired and not just esbuild.

---

## Step 6 — Navigation, and one story at a time

**Goal.** Make the gallery usable at 96 components and beyond. A single scrolling page stops
working around 30.

### Changes

**Two-pane layout.** Sidebar tree on the left, one rendered story on the right.

- The tree is derived from `meta.title` split on `/` — no separate config.
- A filter box that matches on title and story name.
- Arrow-key navigation, and the current story id shown so it can be quoted in a bug report.
- Selection persists in view state, so reopening the tab returns to the same story.

**Render one story at a time.** This is not only a scale concession — overflow measurement
at a given width is only meaningful when the story owns the viewport, and the Step 8 audit
needs mount → measure → unmount to be accurate.

**Contact-sheet mode.** A toggle that renders every story in the selected subtree at once,
for scanning a folder. Same renderer, different wrapper. It skips stories whose host is not
`leaf` (see Step 7).

**Chrome:** a width selector — 300 / 340 / 400 / 600px — constraining the render area with
the current width shown, and a one-line note: *"Switch themes in Obsidian settings; the
gallery follows."*

**Respect `parameters.layout`:** `padded` (default), `centered`, `fullscreen`. A layout
container inspected inside a padded card tells you nothing.

### Deliverable

The gallery is navigable at scale and every story can be inspected at real pane widths.

### Verify

1. With stories for at least three components across two different `ui/` directories, the
   sidebar shows a nested tree matching their `title` paths.
2. Typing in the filter narrows the tree; clearing it restores.
3. Selecting a story renders only that story. Arrow keys move between siblings.
4. Set the width to 300px. The Button `Sizes` row wraps rather than overflowing.
5. Switch to default light, then to a community theme. The current story re-renders correctly
   at 300px in each, without reload.
6. Contact-sheet mode renders the whole subtree; switching back returns to the single story.
7. Close and reopen the gallery tab — the previously selected story is still selected.

---

## Step 7 — Host environments

**Goal.** Render each component in the Obsidian host it was designed for. A component built
for a modal, inspected inline, is being verified against the wrong container.

### Changes

`parameters.gallery.host` — settable on the meta or on an individual story — tells the
gallery which **real** Obsidian host to mount into — not a reconstruction of one, which is the whole advantage of being a plugin:

| `host` | Mounts into |
|---|---|
| `leaf` *(default)* | the gallery's own view |
| `modal` | a real `new Modal(app)` — reuse `src/components/modals/ReactModal.tsx` |
| `popover` | a real popover anchored to a trigger button in the render pane |
| `settings-tab` | a container carrying the settings-tab class ancestry |

```tsx
const meta = {
  title: "Modals/ConfirmModal",
  component: ConfirmModalContent,
  parameters: { gallery: { host: "modal" } },
} satisfies Meta<ConfirmModalProps>;
export default meta;

export const Destructive: StoryObj<ConfirmModalProps> = {
  args: { title: "Delete skill?", confirmLabel: "Delete", variant: "destructive" },
};

export const LongBody: StoryObj<ConfirmModalProps> = {
  args: { title: "…", body: fixtures.longBody },
};
```

Non-`leaf` hosts are inherently one-at-a-time: opening the story opens the host, closing it
returns to the gallery. Contact-sheet mode lists them as cards that open on click rather than
rendering them inline.

**Shared providers, as a component not a decorator.** Export `GalleryProviders` from the
gallery — `AppContext`, `Tooltip.Provider`, event-target stubs — and let stories wrap with
it directly:

```tsx
export const WithMessages: StoryObj<ChatContainerProps> = {
  render: () => (
    <GalleryProviders>
      <ChatContainer messages={fixtures.threeMessages} />
    </GalleryProviders>
  ),
};
```

Nothing in the gallery interprets this — it is ordinary JSX inside `render`, which is why
`decorators` can stay excluded without losing anything.

**Fixtures.** Composite and feature components need realistic data. Put fixtures next to the
stories (`*.fixtures.ts`), not in the gallery. They are the mechanism by which error,
empty, rate-limited, and missing-credential states finally get looked at — which is the
point of the whole exercise.

### Deliverable

Modal-, popover-, and settings-hosted components are inspectable at full fidelity.

### Verify

1. A story with `host: "modal"` opens a real Obsidian modal — it has the native close
   button, backdrop, and Escape-to-close behaviour, and matches a real modal in the plugin
   side by side.
2. Closing it returns to the gallery with the same story still selected.
3. A composite story wrapped in `<GalleryProviders>` renders without context errors in
   `dev:console`.
4. A story with `parameters.gallery.layout === "fullscreen"` fills the leaf; one with
   `padded` does not.
5. Contact-sheet mode does not attempt to inline-render the modal story.

---

## Step 8 — Make the gallery agent-drivable

**Goal.** Let an agent render any story in any theme at any width and assert on the result,
with no human in the loop and no screenshots.

### Changes

**1. Stable selectors.** Wrap each rendered case in a container carrying its identity:

```tsx
<div data-story={`${meta.title}/${name}`} data-story-width={width}>
```

Then `dev:dom selector='[data-story="Button/Variants"]' all` addresses one case exactly.

**2. External control.** Expose a handle the CLI can call through
`dev:cdp method=Runtime.evaluate`:

```ts
window.__gallery = {
  list: () => string[],                                  // every story id
  show: (id: string, opts?: { width?: number }) => void, // render one case, set width
  audit: (opts?: { widths?: number[] }) => AuditReport,  // sweep and report
};
```

Theme is not settable from here — it is an Obsidian setting. The agent switches it with
`dev:cdp` against Obsidian's own appearance settings, or the sweep is run once per theme.

**3. Automated per-story checks.** `audit()` renders every story at each width and returns
machine-readable findings rather than pixels:

| Check | Method |
|---|---|
| Overflow | `el.scrollWidth > el.clientWidth` on the story container |
| Render failure | React error boundary per story; report the caught error |
| Contrast | computed foreground vs. background, flag below WCAG AA |
| Off-token color | computed color not present in the resolved Obsidian variable set |
| Zero-size render | `getBoundingClientRect()` width or height of 0 |

The sweep mounts and unmounts one story at a time, and opens/closes the host for non-`leaf`
stories. Measuring several stories in one pass gives wrong overflow numbers.

Report shape:

```json
{ "theme": "obsidian-dark", "width": 300,
  "findings": [
    { "story": "Button/Sizes", "check": "overflow", "detail": "scrollWidth 412 > 300" },
    { "story": "Card/Error",   "check": "contrast", "detail": "2.9:1, needs 4.5:1" }
  ] }
```

**4. Error boundary per story.** One story that throws must not blank the gallery — it must
report itself as a finding. This is what makes the sweep trustworthy.

**5. Document the loop** in `designdocs/agents/TESTING_GUIDE.md`, next to the existing CLI
recipes, so agents discover it.

### Deliverable

An agent can verify every component state without a human looking at anything.

### Verify

1. `$OBS vault=$VAULT dev:cdp method=Runtime.evaluate params='{"expression":"window.__gallery.list()"}'`
   returns every story id.
2. `dev:dom selector='[data-story="Button/Variants"]' all` returns that case's markup.
3. Add a deliberately broken story (`render: () => { throw new Error("boom") }`). The
   gallery still renders everything else, and `audit()` reports it as a finding. Remove it.
4. Add a deliberately overflowing story at 300px. `audit({widths:[300]})` reports an
   overflow finding with the measured widths. Remove it.
5. `dev:errors` is clean after a full `audit()` run — findings are reported as data, not
   thrown.

---

## Step 9 — Boundaries and hygiene

**Goal.** Stop the gallery quietly growing a dependency on the plugin, and stop it breaking
existing tooling.

### Changes

**Import boundary** in `eslint.config.mjs`, following the existing `createRoot` guardrail
pattern already in that file:

```js
{
  files: ["dev/gallery/**/*.{ts,tsx}"],
  rules: {
    // Use the typescript-eslint variant: it supports allowTypeImports, without
    // which this rule blocks `import type` statements that are erased at compile
    // time and carry no runtime coupling.
    "@typescript-eslint/no-restricted-imports": ["error", {
      patterns: [{
        group: ["@/*", "!@/components/ui/*", "!@/lib/*", "!@/utils"],
        allowTypeImports: true,
        message: "The gallery may only import values from @/components/ui, @/lib, and " +
                 "@/utils. Type-only imports are fine. If a primitive needs plugin " +
                 "state to render, that is a coupling problem in the primitive, not a " +
                 "reason to widen this rule.",
      }],
    }],
  },
}
```

**Other hygiene:**

- `tsconfig.json`'s `include` is `["**/*.ts", "src", "typings/**/*.ts"]` — it will not pick
  up `dev/gallery/*.tsx`. Add `"dev/gallery"`, or `tsc -noEmit` silently skips the gallery.
- Register the gallery entry point in `knip.json`, or `npm run lint:dead` flags it.
- `.gitignore`: `dev/gallery/main.js`, `dev/gallery/styles.css`,
  `dev/gallery/stories.generated.ts`.
- `.gitignore` must **not** exclude `*.stories.tsx` — those are source.

### Deliverable

The boundary is enforced by tooling rather than by intent.

### Verify

1. Add `import { getSettings } from "@/settings/model";` to a gallery file →
   `npm run lint` fails with the custom message. Remove it.
2. `npm run build` still succeeds and produces an unchanged `main.js`.
3. `npm run lint:dead` reports no new unused files.
4. `npx tsc -noEmit` type-checks the gallery — introduce a deliberate type error in
   `Gallery.tsx` and confirm it is caught, then remove it.

---

## Step 10 — Build one real component through the loop

**Goal.** Prove the infrastructure serves real work. This is the acceptance test for
Steps 0–9.

### Changes

Pick a component that is genuinely needed and does not exist yet. Build it **story-first**:
write `<name>.stories.tsx` enumerating the states you expect before writing the component
itself, then implement until every story renders.

### Deliverable

One real component, with stories, verified across themes at pane width.

### Verify

1. Every state renders at 300px without overflow.
2. Every state renders legibly in default light, default dark, and two community themes.
3. The component uses no arbitrary Tailwind values and no literal color values — every color
   resolves to an Obsidian CSS variable via the tokens in `tailwind.config.js`.
4. It composes from existing primitives (`card`, `button`, `badge`, `setting-item`) rather
   than introducing new ones. If it must introduce one, note why in the PR description.

---

## Summary

| Step | Deliverable | Verified by |
|---|---|---|
| 0 | Primitives decoupled, boundary linted | Prod build + tests pass; lint fails on a value import from `@/settings`, passes on `import type` |
| 1 | Gallery plugin loads, empty | Separate entry in Community plugins; empty tab opens; `main.js` untouched |
| 2 | One component, correct CSS | Side-by-side identical to the Copilot pane across 3 themes |
| 3 | Stories drive the gallery | New named export appears without editing gallery code; `decorators` / `play` are compile errors |
| 4 | Generated index + coverage | New `*.stories.tsx` appears with no index edit; count correct |
| 5 | Watch + hot reload | Story edit visible in seconds, no manual commands |
| 6 | Navigable at scale + width/theme chrome | Nested tree from titles; filter narrows; one story renders at 300px |
| 7 | Real host environments | `host: "modal"` opens a native Obsidian modal matching the real one |
| 8 | Agent-drivable | `window.__gallery.audit()` reports overflow and contrast findings as JSON |
| 9 | Enforced boundaries | Forbidden import fails lint; production build unchanged |
| 10 | First real component | All states × four themes at 300px, audit clean |

Steps 0–3 are the minimum that unblocks component development — usable for a handful of
components. Steps 4–7 are what make it survive 96 of them. Step 8 makes it verifiable
without a human. Steps 9–10 lock it in. **Step 2's verification is the one that must not be waived** — it is the only
evidence that what the gallery shows is what users see.
