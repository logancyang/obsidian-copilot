import type { AgentFileManager, AgentMemoryRead } from "@/agents/AgentFileManager";
import {
  AGENT_MEMORY,
  createAgentMemoryExtension,
  holdMemoryNotice,
  markMemorizedThrough,
  releaseHeldMemoryNotice,
  showMemoryNotice,
  type AgentMemoryChatState,
} from "@/agents/agentMode/agentMemoryChat";
import type { CustomAgent } from "@/agents/types";
import type { PromptNote } from "@/agentMode/session/chatExtension";
import type { SessionAgent } from "@/agentMode/session/sessionAgent";
import { fakeChatView } from "@/agentMode/session/testing/fakeChat";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { AI_SENDER, USER_SENDER } from "@/constants";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const JENNIFER_CHAT: SessionAgent = {
  slug: "jennifer",
  name: "Jennifer",
  icon: "🪶",
  personaBlock: "<agent_persona/>",
};

const FLUSH_NOTICE = {
  kind: "flush" as const,
  agentName: "Jennifer",
  path: "copilot/agents/jennifer/memory/2026-09-17.md",
};

const CONSOLIDATION_NOTICE = {
  kind: "consolidation" as const,
  agentName: "Jennifer",
  path: "copilot/agents/jennifer/MEMORY.md",
};

function jennifer(overrides: Partial<CustomAgent> = {}): CustomAgent {
  return {
    slug: "jennifer",
    name: "Jennifer",
    description: "Skeptical editor.",
    icon: "🪶",
    backendId: null,
    modelId: null,
    effort: null,
    memoryEnabled: true,
    created: "2026-09-16T10:00:00Z",
    instructions: "You are Jennifer.",
    ...overrides,
  };
}

function memoryDocument(body: string): AgentMemoryRead {
  return { text: body, body, consolidatedThrough: null, modifiedAtMs: 0, hash: body };
}

function buildFiles(
  agent: CustomAgent | null,
  body = "## About the user\n\n- Writes a newsletter."
) {
  const files = {
    readAgent: jest.fn(async () => (agent ? { agent } : null)),
    readMemoryDocument: jest.fn(async () => memoryDocument(body)),
    readDailyNotesAfter: jest.fn(async () => []),
  };
  return { files, typed: files as unknown as AgentFileManager };
}

function message(id: string, sender: string): AgentChatMessage {
  return { id, sender, message: id, timestamp: null, isVisible: true };
}

const ONE_TURN = [message("u1", USER_SENDER), message("a1", AI_SENDER)];

function state(overrides: Partial<AgentMemoryChatState> = {}): AgentMemoryChatState {
  return { ...AGENT_MEMORY.initial, ...overrides };
}

describe("agentMemoryChat", () => {
  describe("createAgentMemoryExtension()", () => {
    it("saves how far the chat has been memorized in the chat note, and nothing before any flush", () => {
      const { noteField } = createAgentMemoryExtension(buildFiles(null).typed);

      expect(noteField?.save(state())).toBeNull();
      expect(noteField?.save(state({ memorizedThroughTurn: 4 }))).toBe(4);
      expect(noteField?.key).toBe("memorizedThroughTurn");
    });

    it("restores the saved marker when a chat reopens, ignoring a value that is not ahead of it", () => {
      const { noteField } = createAgentMemoryExtension(buildFiles(null).typed);

      expect(noteField?.restore(state(), 3)).toEqual(state({ memorizedThroughTurn: 3 }));
      expect(noteField?.restore(state(), -1)).toEqual(state());
    });

    it("leads the chat's next message with what the agent knows, and records it told once delivered", async () => {
      const { typed } = buildFiles(jennifer());
      const extension = createAgentMemoryExtension(typed);

      const note = (await extension.beforePrompt!(
        state(),
        fakeChatView([], JENNIFER_CHAT)
      )) as PromptNote<AgentMemoryChatState>;

      expect(note.note).toContain('<agent_memory name="Jennifer"');
      expect(note.note).toContain("Writes a newsletter.");
      expect(note.leads).toBe(true);
      const delivered = note.delivered(state());
      expect(delivered.injectedFingerprint).not.toBeNull();
      expect(await extension.beforePrompt!(delivered, fakeChatView([], JENNIFER_CHAT))).toBeNull();
    });

    it("sends the block again once the agent's memory files change", async () => {
      const before = createAgentMemoryExtension(buildFiles(jennifer(), "- Old fact.").typed);
      const after = createAgentMemoryExtension(buildFiles(jennifer(), "- New fact.").typed);
      const chat = fakeChatView([], JENNIFER_CHAT);
      const told = (
        (await before.beforePrompt!(state(), chat)) as PromptNote<AgentMemoryChatState>
      ).delivered(state());

      const note = (await after.beforePrompt!(told, chat)) as PromptNote<AgentMemoryChatState>;

      expect(note.note).toContain("New fact.");
    });

    it("adds nothing, without reading any file, in a chat held with Copilot", () => {
      const { files, typed } = buildFiles(jennifer());

      expect(createAgentMemoryExtension(typed).beforePrompt!(state(), fakeChatView())).toBeNull();
      expect(files.readAgent).not.toHaveBeenCalled();
    });

    it("adds nothing for an agent whose memory toggle is off or that was deleted", async () => {
      const off = createAgentMemoryExtension(buildFiles(jennifer({ memoryEnabled: false })).typed);
      const gone = createAgentMemoryExtension(buildFiles(null).typed);
      const chat = fakeChatView([], JENNIFER_CHAT);

      expect(await off.beforePrompt!(state(), chat)).toBeNull();
      expect(await gone.beforePrompt!(state(), chat)).toBeNull();
    });

    it("adds nothing rather than failing the message when the agent cannot be read", async () => {
      const { files, typed } = buildFiles(jennifer());
      files.readAgent.mockRejectedValue(new Error("EACCES"));

      expect(
        await createAgentMemoryExtension(typed).beforePrompt!(
          state(),
          fakeChatView([], JENNIFER_CHAT)
        )
      ).toBeNull();
    });
  });

  describe("markMemorizedThrough()", () => {
    it("advances the marker to the turn a flush covered", () => {
      expect(markMemorizedThrough(state({ memorizedThroughTurn: 2 }), 4)).toEqual(
        state({ memorizedThroughTurn: 4 })
      );
    });

    it("keeps the same state when the turn is not ahead of the marker", () => {
      const current = state({ memorizedThroughTurn: 4 });

      expect(markMemorizedThrough(current, 4)).toBe(current);
      expect(markMemorizedThrough(current, Number.NaN)).toBe(current);
    });
  });

  describe("showMemoryNotice()", () => {
    it("shows the trust line under the chat's latest user turn", () => {
      expect(showMemoryNotice(state(), FLUSH_NOTICE, fakeChatView(ONE_TURN)).notice).toEqual({
        ...FLUSH_NOTICE,
        afterUserTurn: 1,
      });
    });
  });

  describe("holdMemoryNotice()", () => {
    it("keeps a line back without showing it", () => {
      const held = holdMemoryNotice(state(), CONSOLIDATION_NOTICE);

      expect(held.heldNotice).toEqual(CONSOLIDATION_NOTICE);
      expect(held.notice).toBeNull();
    });
  });

  describe("releaseHeldMemoryNotice()", () => {
    it("shows the held line under the chat's latest user turn and stops holding it", () => {
      const released = releaseHeldMemoryNotice(
        holdMemoryNotice(state(), CONSOLIDATION_NOTICE),
        fakeChatView(ONE_TURN)
      );

      expect(released.notice).toEqual({ ...CONSOLIDATION_NOTICE, afterUserTurn: 1 });
      expect(released.heldNotice).toBeNull();
    });

    it("keeps the same state when no line is held", () => {
      const current = state();

      expect(releaseHeldMemoryNotice(current, fakeChatView(ONE_TURN))).toBe(current);
    });
  });
});
