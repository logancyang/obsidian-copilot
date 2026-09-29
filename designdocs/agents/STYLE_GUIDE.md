# Style & Code Guide

Detailed coding conventions for this repo. The cross-cutting principles in
`AGENTS.md` (generalizable solutions, referential stability, issue-linked comments,
no direct `console` calls) always apply; this guide carries the full detail behind the
language, comment, styling, and code-structure rules.

## TypeScript

- Use absolute imports with `@/` prefix: `import { ChainType } from "@/chainFactory"`
- Prefer const assertions and type inference where appropriate
- Use interface for object shapes, type for unions/aliases

## Import boundaries

ESLint enforces module boundaries in two forms: layer rules
(`eslint-plugin-boundaries`, e.g. the agent-mode layers in
`src/agentMode/AGENTS.md`) and path fences (`no-restricted-imports`
allowlists, e.g. the gallery/story fence and the `src/components/ui`
purity fence).

**When a fence rejects an import, fix the structure — never the fence.**
A rejected import means the file is in the wrong place or the dependency
points the wrong way. In order of preference:

1. **Move the file** so it fits an existing boundary. Example: the
   gallery fence admits any `ui/` folder, so a presentational component
   that needs a story belongs under one — `src/agentMode/skills/ui/` and
   `src/agentMode/backends/shared/ui/` follow this convention inside
   layers whose other modules are plugin-coupled.
2. **Re-route the dependency** — pass plugin state in as props, or
   extend the contract surface the boundary already exposes (e.g.
   `BackendDescriptor`) instead of reaching across layers.
3. **Create a new boundary** when a genuinely new kind of module has
   appeared: a named folder plus its own lint rule and a documented
   contract (see "Adding a new layer" in `src/agentMode/AGENTS.md`).

Never widen a fence with a per-file exemption (a `SomeComponent$` regex
carve-out, an extra `!@/...` negation for one module). Each carve-out
silently redefines what the boundary means, invites the next one, and
leaves the file somewhere its folder no longer describes. If none of the
three options above works, the boundary itself is wrong — change the
boundary deliberately, in its own reviewed change, with the layer rules
in `src/agentMode/AGENTS.md` updated to match.

## React

- Custom hooks for reusable logic
- Props interfaces defined above components
- Prefer `useSyncExternalStore` for mutable external sources that expose a
  snapshot and subscription. Do not subscribe and increment dummy state solely
  to force a render. Snapshots must remain referentially stable while their
  semantic value is unchanged; continue to use `useState` for component-owned
  UI state.

## Comments

Comments are never compiled or tested, so they drift from the code and mislead the next reader,
human or agent. Names, types, and tests carry **what** the code does; a GitHub issue carries the
**why**.

- **Every comment links a GitHub issue.** A comment exists only to record a tricky decision tied to
  a specific issue: one line of why plus the issue's full URL
  (`https://github.com/OWNER/REPO/issues/N`). Short refs (`#123`, `owner/repo#123`) and PR links do
  not count. A block of consecutive `//` lines counts as one comment, so the URL may sit on any of
  its lines. `copilot/issue-linked-comments` fails `npm run lint` on anything else.
- **No JSDoc, banners, restated logic, or issue-less TODOs.** Express a callable's contract through
  its name, parameter names, and types, and its behavior through tests. File an issue instead of
  leaving a TODO.
- **Write the line for a first-time reader of the current code.** State the constraint the code
  still has, not what a change added or removed, and never milestone or plan-step references.
- **Keep issue-linked comments true.** When you change code under one, re-read its issue and update
  or delete the comment in the same change. Delete it once the constraint no longer applies.
- **Tool directives are exempt.** `eslint-disable*` (with a `--` description), `@ts-expect-error`,
  `prettier-ignore`, `@jest-environment`, `/// <reference>`, and bundler annotations such as
  `@__PURE__` are instructions to tools, not prose.
- **An empty `catch {}` needs no comment.** Ignoring the error is already explicit in the code.

## CSS & Styling

- **NEVER edit `styles.css` directly** - This is a generated file
- **Source file**: `src/styles/tailwind.css` - Edit this file for custom CSS
- **Build process**: `npm run build:tailwind` compiles `src/styles/tailwind.css` → `styles.css`
- **Tailwind-first React styling**: Keep static styles on the React elements that own them. Do not create a component-specific selector family such as `.feature`, `.feature-copy`, and `.feature-actions` merely to replace Tailwind utilities in `className`. This hides the component's styling in a second file and leaves stale selectors, tests, and stories when the component changes.
- **Choose styling in this order**:
  1. Reuse or extend an existing shared component when the visual pattern already exists.
  2. Use configured Tailwind utilities directly on React-owned JSX. See `tailwind.config.js` for available classes.
  3. Extend `tailwind.config.js` when a missing token or utility will be reused.
  4. Add a rule to `src/styles/tailwind.css` only when React does not own the target markup, an external integration requires a stable selector, or Tailwind cannot express the required selector or property. Put a short comment beside the rule naming that constraint. A long utility list is not a reason to add custom CSS.
- **Test behavior, not styling hooks**: Do not keep one-off CSS classes so tests can find elements. Query by role, label, visible copy, or another user-facing contract. Use a `data-*` attribute only when no semantic query fits.
- **No arbitrary font-size values**: Never use Tailwind's arbitrary-value syntax for typography (e.g. `tw-text-[10.5px]`, `tw-text-[13px]`). Stick to the configured `fontSize` tokens (`tw-text-ui-smaller`, `tw-text-ui-small`, `tw-text-xs`, `tw-text-smallest`, etc.) so type stays consistent with Obsidian's CSS variables. If none of the existing tokens fit, extend the `fontSize` scale in `tailwind.config.js` rather than hard-coding a pixel value at the call site.
- **No inline `style={{ ... }}`**: Reserve the `style` prop for values that must change dynamically at runtime (computed positions, animated transforms). Static visual changes belong in Tailwind classes or the shared component (e.g. `Button` variants/sizes).
- **Always wrap Tailwind class strings with `cn()`** (from `@/lib/utils`) whenever the classes live anywhere other than a literal `className=` attribute on a JSX element — variable assignments, ternaries, function returns, props passed to other components, etc. `eslint-plugin-tailwindcss` only lints classes it can statically see inside JSX `className` literals or inside calls to its registered callees (`cn`, `clsx`, `classnames`, `ctl`, `cva`). Use `cn()` for composition too — instead of a ternary between two whole class strings, merge a shared base with conditional fragments: `cn("tw-flex tw-text-sm", expandable && "tw-cursor-pointer")`.
- **Raw `<button>` elements must be explicitly reset/styled**: Prefer the
  design-system `Button` component (`@/components/ui/button`) for ordinary
  command buttons. When the native element is a better semantic fit (for
  example tabs, segmented controls, icon-only controls, or compact custom
  widgets), a raw `<button>` is fine, but account for Preflight being off:
  explicitly set the visual reset/interaction styles you rely on (background,
  border, radius, padding, text color, hover/focus/disabled states, etc.) so
  Obsidian/browser defaults do not leak into the UI.

## Writing testable code (dependency injection)

Structure new code so it can be tested by calling it directly with plain
arguments — no singleton or import has to be live for the test to run.

1. **Pass data, not services** — If a function only needs a string (like `outputFolder`), accept it as a parameter. Don't give it access to the entire settings singleton.
2. **Singletons at the edges only** — `getSettings()`, `PDFCache.getInstance()`, `BrevilabsClient.getInstance()` should only be called in top-level orchestration (constructors, main entry points). Inner functions receive what they need as parameters.
3. **Pure logic in leaf modules** — Extract testable logic into small files with minimal imports. The orchestration file (which has heavy imports) calls the leaf function and passes in the dependencies.
4. **Litmus test before writing a function** — "Can I test this by calling it directly with plain arguments?" If the answer is no because of an import, that dependency should be a parameter instead.
