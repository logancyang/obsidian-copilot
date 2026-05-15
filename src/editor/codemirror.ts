// Re-exports for the @codemirror/* APIs the plugin uses.
//
// Why this barrel exists: Obsidian provides @codemirror/state and
// @codemirror/view at runtime (declared as peerDependencies on `obsidian` and
// marked external in esbuild.config.mjs), so they aren't listed in our own
// package.json — when we listed them as devDependencies, the obsidian
// community-plugins review ran out of memory analyzing the resulting dep tree.
// The `import/no-extraneous-dependencies` ESLint rule has no per-package
// whitelist, so we funnel every @codemirror import through this single file
// and exempt only this file in eslint.config.mjs (paired with a
// `no-restricted-imports` rule that forbids direct @codemirror imports
// elsewhere). All other source files import codemirror symbols from
// `@/editor/codemirror`.

export { EditorState, StateEffect, StateField } from "@codemirror/state";
export type { ChangeDesc, Extension, StateEffectType } from "@codemirror/state";
export { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
export type { ViewUpdate } from "@codemirror/view";
