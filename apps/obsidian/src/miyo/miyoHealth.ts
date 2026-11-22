export interface MiyoHealthRelay {
  enabled?: boolean;
  status?: string;
}

export interface MiyoHealthChatSyncPlatform {
  accounts?: number;
  connected?: boolean;
  conversation_count?: number;
  syncing?: boolean;
  last_sync_at?: string | null;
}

export interface MiyoHealthChatSync {
  configured?: boolean;
  active?: boolean;
  platforms?: Record<string, MiyoHealthChatSyncPlatform | undefined>;
}

export interface MiyoHealthResponse {
  status?: string;
  relay?: MiyoHealthRelay;
  chat_sync?: MiyoHealthChatSync;
}
