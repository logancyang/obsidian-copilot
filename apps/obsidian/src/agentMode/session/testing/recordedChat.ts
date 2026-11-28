import type { AgentMessageStore } from "@/agentMode/session/AgentMessageStore";
import type { AgentChatMessage, TurnFileChange } from "@/agentMode/session/types";
import { AI_SENDER, USER_SENDER } from "@/constants";
import type { FormattedDateTime } from "@/types/message";

const at = (epoch: number, display: string): FormattedDateTime => ({
  epoch,
  display,
  fileName: display.replace(/\D/g, ""),
});

const ASKED_AT = at(1_767_268_800_000, "2026/01/01 12:00:00");
const RETRIED_AT = at(1_767_268_860_000, "2026/01/01 12:01:00");
const STOPPED_AT = at(1_767_268_920_000, "2026/01/01 12:02:00");

const PLAN_EDIT: TurnFileChange = {
  path: "Projects/Plan.md",
  status: "modified",
  before: "- first\n",
  after: "- first\n- second\n",
  additions: 1,
  deletions: 0,
};

const SAVED_RULE = {
  agentName: "Coco",
  memoryPath: "copilot/teammates/coco/MEMORY.md",
  rule: "Plans list owners next to each step.",
};

const ASKED_RUN = {
  id: "mention-1",
  agent: "maya",
  name: "Maya",
  status: "finished" as const,
  startedAt: 1_767_268_801_000,
  chat: { backendId: "claude", sessionId: "hidden-1" },
};

export function driveRecordedChat(store: AgentMessageStore): void {
  const asked = store.addMessage({
    id: "prompt-1",
    message: "Add a second step to the plan",
    sender: USER_SENDER,
    timestamp: ASKED_AT,
    isVisible: true,
    context: {
      notes: [],
      urls: [],
      folders: ["Projects"],
      selectedTextContexts: [
        { id: "quote-1", sourceType: "chat", content: "first step", comment: "keep it" },
      ],
    },
  });
  const reply = store.addMessage({
    message: "",
    sender: AI_SENDER,
    timestamp: ASKED_AT,
    isVisible: true,
    parts: [],
  });
  store.appendAgentThought(reply, "Reading the ");
  store.appendAgentThought(reply, "plan first.");
  store.upsertAgentPart(reply, {
    kind: "tool_call",
    id: "read-1",
    title: "Read Projects/Plan.md",
    toolKind: "read",
    status: "pending",
    locations: [{ path: "Projects/Plan.md" }],
  });
  store.upsertAgentPart(reply, {
    kind: "tool_call",
    id: "read-1",
    title: "Read Projects/Plan.md",
    toolKind: "read",
    status: "completed",
    locations: [{ path: "Projects/Plan.md" }],
    output: [{ type: "text", text: "- first" }],
  });
  store.upsertAgentPart(reply, {
    kind: "plan",
    entries: [{ content: "Append the step", priority: "high", status: "in_progress" }],
  });
  store.upsertAgentPart(reply, {
    kind: "tool_call",
    id: "edit-1",
    title: "Edit Projects/Plan.md",
    toolKind: "edit",
    status: "completed",
    locations: [{ path: "Projects/Plan.md" }],
  });
  store.appendAgentText(reply, "Added ");
  store.appendAgentText(reply, "the second step.");
  store.markTurnComplete(reply, "end_turn", 4_200);
  store.extendTurnDuration(reply, 4_900);
  store.setFileChanges(reply, [PLAN_EDIT], [SAVED_RULE]);
  store.setAgentMentions(asked, [ASKED_RUN]);

  store.addMessage({
    id: "prompt-2",
    message: "Now sort it",
    sender: USER_SENDER,
    timestamp: RETRIED_AT,
    isVisible: true,
  });
  const empty = store.addMessage({
    message: "",
    sender: AI_SENDER,
    timestamp: RETRIED_AT,
    isVisible: true,
    parts: [],
  });
  store.deleteMessage(empty);
  const failed = store.addMessage({
    message: "",
    sender: AI_SENDER,
    timestamp: RETRIED_AT,
    isVisible: true,
    parts: [],
  });
  store.appendAgentText(failed, "Sorting");
  store.upsertAgentPart(failed, {
    kind: "tool_call",
    id: "bash-1",
    title: "Run sort",
    status: "pending",
  });
  store.upsertAgentPart(failed, {
    kind: "compaction",
    id: "compact-1",
    status: "in_progress",
    trigger: "auto",
    startedAtMs: 1_767_268_861_000,
  });
  store.settleOpenParts(failed, "failed");
  store.markMessageError(failed, "Rate limited", 1_200);

  store.addMessage({
    id: "prompt-3",
    message: "Try once more",
    sender: USER_SENDER,
    timestamp: STOPPED_AT,
    isVisible: true,
  });
  const stopped = store.addMessage({
    message: "",
    sender: AI_SENDER,
    timestamp: STOPPED_AT,
    isVisible: true,
    parts: [],
  });
  store.upsertAgentPart(stopped, {
    kind: "tool_call",
    id: "write-1",
    title: "Write Projects/Plan.md",
    toolKind: "edit",
    status: "in_progress",
  });
  store.upsertAgentPart(stopped, {
    kind: "tool_call",
    id: "task-1",
    title: "Background check",
    status: "in_progress",
  });
  store.markPermissionDeclined(stopped);
  store.stopToolCalls(stopped, new Set(["task-1"]));
  store.markCancelledByAgent(stopped);
  store.markTurnComplete(stopped, "cancelled", 800);
}

export function reopenRecordedChat(
  store: AgentMessageStore,
  saved: readonly AgentChatMessage[]
): void {
  store.loadMessages(
    saved.map((message) => ({ ...message, timestamp: null, toolsUsed: undefined }))
  );
  store.adoptNoteRows(saved);
}
