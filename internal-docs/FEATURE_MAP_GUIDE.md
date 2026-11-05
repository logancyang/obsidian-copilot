# Feature map guide

How to keep [`feature-map/`](feature-map/README.md) true. The map describes what users can do and see, so it changes when the product does, not when the code does.

## When to update

After every user-facing change, check the feature files the change touches. Update the map only when one of these changed:

- A part of the screen, a control, or an entry point was added, removed, or renamed.
- A rule the user can observe changed, such as what keeps a chat's agent running.
- Verifying the change hit a trap the next run would hit too.

Refactors, moved files, internal renames, and bug fixes that restore the documented behavior need no update.

## What is a feature

A part of the screen a user can point at, named by its UI noun: `chat-tabs`, `copilot-navigator`. Give a part its own file when it has its own actions: one chat row has pin, rename, and close, so `chat-rows` is separate from the Navigator that lists them. Goals ("go back to a past chat") and internal concepts (sessions, managers) are not features.

New features go in the README under their area. List an unmapped one there as `name (not mapped yet)` so the index stays complete.

## Writing an entry

Follow the README's entry contract: an H1, one line on what the user sees, then the four H2s.

- **Sub-features:** `kebab-id: one line` per capability the user can see. Each should be small enough to verify on its own and could grow into its own file. Keep IDs stable; rename one only when the capability changes.
- **How to get to it (user POV):** every entry point, by its visible name: commands, buttons, menus.
- **Driving it:** one bullet per sub-feature at least, as `Label: user action. Observable result.` Describe only what the user does and sees in the app; how to drive it belongs to whoever runs the map. Shared setup lives in the README's Baseline; name extra state only when the feature needs it, such as a license. Edge cases belong in unit tests, not here.
- **Gotchas:** traps that waste or invalidate a run, or that changes tend to break.

## Multi-surface journeys

Most behavior belongs to one surface: the one where the user acts. When its result shows somewhere else, say where to look ("its row no longer offers `Close chat`"), but keep it on the acting surface.

A behavior goes in `multi-surface-journeys.md` only when no single surface can state it: the outcome depends on what happens on several surfaces at once or in sequence, and a break would not show in any one surface's steps. Two chats replying at once must stay separate, and a permission request from a chat in the background must reach the user wherever they are.

Each journey gets an H2, one line on what must hold, a few steps, and a `Touches:` line naming the features involved, mapped or not. Name controls as the surface files do, and do not restate their rules. When a single surface can state a journey, move it there.

## Keep out

- File paths, function and class names, CSS selectors and classes, data attributes, and internal state names. Visible names and tooltips are fine: they change only when the UI copy changes, and then the entry must change anyway.
- Edit history and rationale for past versions. Those go in the PR.

Before committing, check the diff has no `src/`, `.ts`, or `()` and run `npm run format`.
