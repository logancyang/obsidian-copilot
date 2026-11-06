# Feature map guide

How to keep [`feature-map/`](feature-map/README.md) true. The map describes what users can do and see, so it changes when the product does, not when the code does.

## When to update

After every user-facing change, check the feature files the change touches. Update the map only when one of these changed:

- A part of the screen, a control, or an entry point was added, removed, or renamed.
- A rule the user can observe changed, such as what keeps a chat's agent running.
- Verifying the change hit a trap the next run would hit too.

Refactors, moved files, internal renames, and bug fixes that restore the documented behavior need no update.

## What is a feature

A part of the screen a user can point at, named by its UI noun: [chat tabs](feature-map/chat-tabs.md), [Copilot Navigator](feature-map/copilot-navigator.md). Give a part its own file when it has its own actions: one chat row has pin, rename, and close, so [chat rows](feature-map/chat-rows.md) are separate from the Navigator that lists them. Goals ("go back to a past chat") and internal concepts (sessions, managers) are not features.

New features go in the README under their area. Every feature gets a file so it can be linked. A file can start light: the title, one line on what the user sees, a short Sub-features list, and a closing line that only the sub-features are mapped. Mark it `(sub-features only)` in the README index, and write the other sections when a change first needs them. Link another feature to its file wherever a section first mentions it; never name a feature in code formatting.

The map does not claim full coverage. A sub-feature list holds what someone has mapped, not every capability. When you find one it misses, add it.

## Writing an entry

Follow the README's entry contract: an H1, one line on what the user sees, then the four H2s, or only Sub-features for a light file.

- **Sub-features:** `kebab-id: one line` per capability the user can see. Each should be small enough to verify on its own and could grow into its own file. Keep IDs stable; rename one only when the capability changes.
- **How to get to it (user POV):** every entry point, by its visible name: commands, buttons, menus.
- **Driving it:** one bullet per sub-feature at least, as `Label: user action. Observable result.` Describe only what the user does and sees in the app; how to drive it belongs to whoever runs the map. Shared setup lives in the README's Baseline; name extra state only when the feature needs it, such as a license. Edge cases belong in unit tests, not here.
- **Gotchas:** product behavior that surprises: a rule that reaches past this feature, or one that changes tend to break. How to find a control or set up a run belongs in `TESTING_GUIDE.md`.

## Multi-surface journeys

Most behavior belongs to one feature: the one where the user acts. When its result shows somewhere else, say where to look ("its row no longer offers `Close chat`"), but keep it in the acting feature's file.

`multi-surface-journeys.md` walks the product's main flows across features, at a high level, so a reader sees how the parts fit together. A journey is one thing a user sets out to do, such as going back to a past chat, with a step for each feature it crosses. Edge cases and past bugs stay out: rules live in the feature files, and edge cases in unit tests and the issue-linked comments beside the code.

Each journey gets an H2 named by the user's goal, one line on that goal, a few steps, and a `Touches:` line linking every feature involved. Name controls as the feature files do, and do not restate their rules.

## Keep out

- File paths, function and class names, CSS selectors and classes, data attributes, and internal state names. Visible names and tooltips are fine: they change only when the UI copy changes, and then the entry must change anyway.
- Edit history and rationale for past versions. Those go in the PR.

Before committing, check the diff has no `src/`, `.ts`, or `()` and run `npm run format`.
