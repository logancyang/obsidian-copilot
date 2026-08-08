# TODO — Required `container` prop on portaled UI primitives

## Status

Not started. Scoped for a separate PR.

## Problem

Radix-based UI primitives in `src/components/ui/` portal their content out of
the parent DOM subtree:

- `DropdownMenuContent`
- `DialogContent`
- `PopoverContent`
- `TooltipContent`
- `SelectContent`

Today these wrappers fall back to `activeDocument.body` (or hardcode it, in
the case of `TooltipContent`) when no `container` prop is supplied. Two
problems with that:

1. **Inside the settings modal**, `activeDocument.body` is outside the modal
   subtree. Portaled content renders, but pointer/hover events get swallowed
   by the modal's overlay — menus open with no highlighted item on hover,
   clicks may not register. The recent fix in `ByokGlobalTable` and
   `ProviderCatalogList` works around this by threading a local
   `containerRef` and passing `container={containerRef.current}` (matches
   `ModelTable`, `PatternListEditor`).
2. **In popout windows**, `activeDocument.body` is wrong even outside a
   modal. `activeDocument` points at whichever window is _focused right
   now_, which may not be the window the component lives in. The correct
   target is `someElement.doc.body` where `someElement` is a DOM node owned
   by the relevant window — i.e. derived from a React ref local to the
   component tree.

The default is silently incorrect, and there's no type-system pressure on
callers to do the right thing.

## Proposed contract

1. Make `container: HTMLElement | null` **required** on every portaled
   wrapper:
   - `DropdownMenuContent`
   - `DialogContent`
   - `PopoverContent`
   - `TooltipContent` (today has no `container` prop at all — add it)
   - `SelectContent`

   Remove the `?? activeDocument.body` fallbacks. The caller must pass
   something. `null` is allowed for the "ref not populated yet on first
   render" case, but the wrapper does not inject a body default.

2. Add a `PortalContainerContext` + `usePortalContainer()` hook so the
   common case (everything below `CopilotView` / `SettingsMainV2` /
   `ConfirmModal` / dialogs) is one-liner:

   ```tsx
   <DropdownMenuContent container={usePortalContainer()}>…</DropdownMenuContent>
   ```

   The provider sets its value from a DOM ref local to the root component,
   so the resolved container is always in the same window as that root
   (popout-safe by construction).

3. Root providers to wire up:
   - `CopilotView` — main chat surface. Provider value = closest in-view DOM
     node, re-derived on `containerEl.onWindowMigrated(...)`.
   - `SettingsMainV2` — `TabProvider` already exposes a `modalContainer`;
     reuse or supersede it with `PortalContainerContext`.
   - Each `Dialog` in `modelManagement/ui/dialogs/` — provide a context
     scoped to the dialog body so descendant menus/popovers/tooltips inside
     the dialog portal back into the dialog (not the page below it).

## Scope of the migration

`grep -rE "(DropdownMenuContent|DialogContent|PopoverContent|TooltipContent|SelectContent)[^a-zA-Z]"`
returns ~108 JSX call sites across ~28 files. `TooltipContent` alone is 44
of those, and they live in leaf components (`ChatButtons`, `SuggestedPrompts`,
`ChatSingleMessage`, etc.) that do not currently have access to any
`containerRef`.

Plan:

1. Land the type change + context provider as one commit. CI breaks on
   every unmigrated callsite (expected).
2. Migrate callsites in batches grouped by feature area:
   - chat-components/\*
   - agentMode/ui/\*
   - settings/v2/\*
   - modelManagement/ui/\* (already migrated for BYOK group / catalog list
     ahead of this work — those use a local ref, which can be swapped for
     the context once it exists).
   - system-prompts/\*
3. Update jest mocks/tests where they assert on the absence of a `container`
   prop. The existing `dropdown-menu` mock in BYOK tests already passes
   children through transparently and won't need changes.

## Non-goals

- Replacing Radix. The primitives stay; only the wrapper contract changes.
- Reworking how `TabContext.modalContainer` is computed. The new context
  can wrap or replace it as a follow-up.
- Migrating `obsidian-native-select.tsx` / `ModelSelector.tsx` /
  `help-tooltip.tsx` if they don't directly portal — audit during the
  migration PR.

## Open questions

- Should `container` accept `null` (current React-ref ergonomics) or be
  strictly `HTMLElement` (forces callers to gate rendering on ref-set)? The
  former is more practical; the latter is stricter. Recommendation: `null`
  allowed, with a JSDoc note that `null` falls back to Radix's own default
  (which is `document.body` — still wrong in popouts, but the type system
  has at least forced the caller to acknowledge the case).

## References

- `ByokGlobalTable.tsx`, `ProviderCatalogList.tsx` — recent local fix using
  the per-component `containerRef` pattern.
- `ModelTable.tsx`, `PatternListEditor.tsx` — same pattern, predates this
  doc.
- `ConfigureProviderDialog.tsx` — uses `useTabOptional()?.modalContainer`
  to portal the dialog itself into `.modal-container`.
- AGENTS.md → "Picking the right `document` / `window` (popout-window
  safety)" — the broader principle this work enforces at the type system.
