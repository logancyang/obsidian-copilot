import type { TranscriptSources } from "@/agentMode/session/AgentMessageStore";

let issuedIds = 0;

export const TEST_TRANSCRIPT_SOURCES: TranscriptSources = {
  now: () => Date.now(),
  newMessageId: () => `msg-test-${++issuedIds}`,
};
