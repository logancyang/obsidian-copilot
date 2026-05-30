# Style & Code Guide

Detailed coding conventions for this repo. The cross-cutting principles in
`AGENTS.md` (generalizable solutions, referential stability, comment-the-why,
no `console.log`) always apply; this guide carries the full detail behind the
language, comment, styling, and code-structure rules.

## TypeScript

- Use absolute imports with `@/` prefix: `import { ChainType } from "@/chainFactory"`
- Prefer const assertions and type inference where appropriate
- Use interface for object shapes, type for unions/aliases

## React

- Custom hooks for reusable logic
- Props interfaces defined above components

## Comments

The code is the source of truth for **what** the code does. Comments exist to
carry the **why** — the things a reader cannot recover by reading the code.

- **Comment the why, not the what.** Document non-obvious constraints,
  invariants, gotchas, and "why this exists / why not the obvious alternative".
  If a comment only restates what the next line plainly says, delete it.
- **Default to minimal comments — JSDoc is not required on every function.** A
  function with a clear name and signature needs no doc block. Add one only when
  there's a why worth recording. When you do write a "what", keep it to one
  short line.
- **Drop redundant `@param`/`@returns`.** Keep a tag only when it adds
  information the type and name don't already convey (e.g. "`null` means the
  agent is CLI-managed, so no key is stored"). Don't write a `@param` line that
  just echoes the parameter name and type.
- **No milestone or plan-step references in code.** Never write `M1`/`M3`,
  `§4.3`, "step 3 of the plan", "after milestone X lands", or similar. These are
  scaffolding for whoever is _writing_ a branch and are meaningless to whoever _reviews or maintains_ the code later.
- **No comments that rot.** Avoid "added for feature X" or "used by caller Y" —
  those go stale as the code moves and belong in the PR description, not the
  source.

## CSS & Styling

- **NEVER edit `styles.css` directly** - This is a generated file
- **Source file**: `src/styles/tailwind.css` - Edit this file for custom CSS
- **Build process**: `npm run build:tailwind` compiles `src/styles/tailwind.css` → `styles.css`
- **Tailwind classes**: Use Tailwind utility classes in components (see `tailwind.config.js` for available classes)
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
