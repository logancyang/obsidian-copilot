/** opencode release Copilot downloads for a managed installation. */
export const OPENCODE_PINNED_VERSION = "1.16.0";

export const OPENCODE_RELEASE_TAG = `v${OPENCODE_PINNED_VERSION}`;

/**
 * Oldest opencode release that satisfies Agent Mode's ACP contract. Version
 * 1.15.13 added the model catalog and 1.16.0 made session cancellation abort
 * the backing turn so a stopped session remains reusable.
 */
export const OPENCODE_MIN_ACP_VERSION = "1.16.0";
