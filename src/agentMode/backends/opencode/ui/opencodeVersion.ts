// Lives in the backend's ui/ leaf so the gallery story can render the same
// versions the installer uses without widening the story import fence.

/** opencode release Copilot downloads for a managed installation. */
export const OPENCODE_PINNED_VERSION = "1.18.31";

/** Custom and managed installations share the managed release's support floor. */
export const OPENCODE_MIN_ACP_VERSION = OPENCODE_PINNED_VERSION;
