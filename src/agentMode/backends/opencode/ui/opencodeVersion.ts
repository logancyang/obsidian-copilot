// Lives in the backend's ui/ leaf so the gallery story can render the same
// versions the installer uses without widening the story import fence.

/**
 * Keep managed installs on the release that loads Copilot's inline config before
 * the first ACP model catalog; later releases can omit Copilot's models there.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/569
 */
export const OPENCODE_PINNED_VERSION = "2.0.3";

/**
 * Oldest OpenCode 2 release Copilot supports for its ACP contract.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/569
 */
export const OPENCODE_MIN_VERSION = "2.0.3";
