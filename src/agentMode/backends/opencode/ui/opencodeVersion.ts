// Before bumping, check that opencodeTrimPlugin.ts still matches OpenCode's
// temp-folder line, worktree hint, session_move tool and report skill: a
// reworded prompt makes the plugin silently stop removing it.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/665
export const OPENCODE_PINNED_VERSION = "2.0.22";

// Chat startup waits for the model catalog OpenCode sends after session/new, first sent in 2.0.21.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/625
export const OPENCODE_MIN_VERSION = "2.0.21";
