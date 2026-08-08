/**
 * Types for the Miyo GET /v0/health payload. Kept in their own module so the
 * per-capability blocks (relay / chat_sync) can grow without bloating
 * {@link MiyoClient}. `status` is the only field older builds guarantee; the
 * sub-blocks are optional and, when absent, map to per-capability "unknown".
 */

/**
 * Relay (Connector) sub-status. Absent when the running Miyo build doesn't
 * report relay state — callers must treat a missing `relay` as "unknown", not
 * "off".
 */
export interface MiyoHealthRelay {
  enabled?: boolean;
  status?: string;
}

/**
 * Per-platform chat-sync status (ChatGPT / Claude). Every field is optional
 * because older Miyo builds omit the block entirely.
 */
export interface MiyoHealthChatSyncPlatform {
  accounts?: number;
  connected?: boolean;
  conversation_count?: number;
  syncing?: boolean;
  last_sync_at?: string | null;
}

/**
 * Chat-sync (Search chat) sub-status. Absent when the running Miyo build doesn't
 * report chat-sync state — treat a missing block as "unknown".
 */
export interface MiyoHealthChatSync {
  configured?: boolean;
  active?: boolean;
  platforms?: Record<string, MiyoHealthChatSyncPlatform | undefined>;
}

/**
 * Parsed GET /v0/health payload.
 */
export interface MiyoHealthResponse {
  status?: string;
  relay?: MiyoHealthRelay;
  chat_sync?: MiyoHealthChatSync;
}
