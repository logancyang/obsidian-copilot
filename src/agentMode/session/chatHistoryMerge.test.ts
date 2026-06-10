import { AI_SENDER, USER_SENDER } from "@/constants";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { buildNativeChatId } from "@/utils/nativeChatId";
import type { AgentSessionIndexEntry } from "./AgentSessionIndex";
import {
  deriveChatTitleFromMessages,
  mergeChatHistoryItems,
  UNTITLED_NATIVE_CHAT,
} from "./chatHistoryMerge";
import type { AgentChatMessage } from "./types";

function msg(sender: string, message: string): AgentChatMessage {
  return {
    id: `${sender}-${message.slice(0, 4)}`,
    sender,
    message,
    isVisible: true,
  } as AgentChatMessage;
}

function mdItem(overrides: Partial<ChatHistoryItem> = {}): ChatHistoryItem {
  return {
    id: "chats/agent__20260601_120000__topic.md",
    title: "Saved chat",
    createdAt: new Date(1_000),
    lastAccessedAt: new Date(2_000),
    backendId: "opencode",
    ...overrides,
  };
}

function nativeEntry(overrides: Partial<AgentSessionIndexEntry> = {}): AgentSessionIndexEntry {
  return {
    backendId: "opencode",
    sessionId: "s1",
    title: "Native chat",
    createdAtMs: 1_500,
    lastAccessedAtMs: 2_500,
    ...overrides,
  };
}

describe("mergeChatHistoryItems", () => {
  it("a session saved as markdown AND present natively appears exactly once, as the markdown item", () => {
    const item = mdItem();
    const merged = mergeChatHistoryItems(
      [{ item, backendId: "opencode", sessionId: "s1" }],
      [nativeEntry({ sessionId: "s1" })]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe(item.id);
    expect(merged[0]?.title).toBe("Saved chat");
  });

  it("the merged item takes whichever side was accessed more recently", () => {
    const item = mdItem({ lastAccessedAt: new Date(2_000) });
    const [fresherNative] = mergeChatHistoryItems(
      [{ item, backendId: "opencode", sessionId: "s1" }],
      [nativeEntry({ lastAccessedAtMs: 9_000 })]
    );
    expect(fresherNative?.lastAccessedAt.getTime()).toBe(9_000);

    const [fresherMarkdown] = mergeChatHistoryItems(
      [
        {
          item: mdItem({ lastAccessedAt: new Date(9_500) }),
          backendId: "opencode",
          sessionId: "s1",
        },
      ],
      [nativeEntry({ lastAccessedAtMs: 9_000 })]
    );
    expect(fresherMarkdown?.lastAccessedAt.getTime()).toBe(9_500);
  });

  it("native-only sessions become items with the encoded native id and backend icon hint", () => {
    const merged = mergeChatHistoryItems([], [nativeEntry({ backendId: "codex" })]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe(buildNativeChatId("codex", "s1"));
    expect(merged[0]?.backendId).toBe("codex");
    expect(merged[0]?.createdAt.getTime()).toBe(1_500);
  });

  it("untitled native sessions fall back to a placeholder title", () => {
    const merged = mergeChatHistoryItems([], [nativeEntry({ title: null })]);
    expect(merged[0]?.title).toBe(UNTITLED_NATIVE_CHAT);
  });

  it("different sessions on different backends never merge, even with the same session id", () => {
    const merged = mergeChatHistoryItems(
      [{ item: mdItem(), backendId: "opencode", sessionId: "s1" }],
      [nativeEntry({ backendId: "codex", sessionId: "s1" })]
    );
    expect(merged).toHaveLength(2);
  });

  it("markdown chats without a sessionId in frontmatter pass through unmerged", () => {
    const merged = mergeChatHistoryItems([{ item: mdItem() }], [nativeEntry({ sessionId: "s1" })]);
    expect(merged).toHaveLength(2);
  });
});

describe("deriveChatTitleFromMessages", () => {
  it("uses the first user message", () => {
    const title = deriveChatTitleFromMessages([
      msg(USER_SENDER, "Summarize today's meeting notes"),
      msg(AI_SENDER, "Sure, here is a summary…"),
    ]);
    expect(title).toBe("Summarize today's meeting notes");
  });

  it("skips a leading assistant/system message and collapses whitespace", () => {
    const title = deriveChatTitleFromMessages([
      msg(AI_SENDER, "How can I help?"),
      msg(USER_SENDER, "  refactor\n   the  parser  "),
    ]);
    expect(title).toBe("refactor the parser");
  });

  it("unwraps wikilinks and elides long messages", () => {
    const long = `Look at [[Project Plan]] and tell me everything that is wrong with the current approach in detail`;
    const title = deriveChatTitleFromMessages([msg(USER_SENDER, long)]);
    expect(title).toContain("Look at Project Plan");
    expect(title!.endsWith("…")).toBe(true);
    expect(title!.length).toBeLessThanOrEqual(61); // 60 chars + ellipsis
  });

  it("returns null when there is no usable user text", () => {
    expect(deriveChatTitleFromMessages([])).toBeNull();
    expect(deriveChatTitleFromMessages([msg(AI_SENDER, "only assistant")])).toBeNull();
    expect(deriveChatTitleFromMessages([msg(USER_SENDER, "   ")])).toBeNull();
  });
});
