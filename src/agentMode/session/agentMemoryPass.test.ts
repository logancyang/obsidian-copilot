import type { AgentFileManager } from "@/agents/AgentFileManager";
import type { CustomAgent } from "@/agents/types";
import {
  buildFanoutMemoryTranscript,
  runAgentMemoryFlush,
} from "@/agentMode/session/agentMemoryPass";
import type { ReadOnlySubSessionRunner } from "@/agentMode/session/readOnlySubSession";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { AI_SENDER, USER_SENDER } from "@/constants";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const JENNIFER: CustomAgent = {
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
};

const TRANSCRIPT: AgentChatMessage[] = [
  {
    id: "u1",
    message: "Cut the hydrogen section.",
    sender: USER_SENDER,
    isVisible: true,
    timestamp: null,
  },
  { id: "a1", message: "Done — it is gone.", sender: AI_SENDER, isVisible: true, timestamp: null },
];

interface Harness {
  files: AgentFileManager;
  subSessions: ReadOnlySubSessionRunner;
  appended: { slug: string; date: string; section: string }[];
  prompts: string[];
  backends: string[];
}

function buildHarness(
  options: {
    agent?: CustomAgent | null;
    answer?: string;
    fail?: Error;
    outcome?: "done" | "aborted";
  } = {}
): Harness {
  const appended: { slug: string; date: string; section: string }[] = [];
  const prompts: string[] = [];
  const backends: string[] = [];
  const agent = options.agent === undefined ? JENNIFER : options.agent;
  const files = {
    readAgent: jest.fn(async () =>
      agent
        ? {
            agent,
            folderPath: `copilot/agents/${agent.slug}`,
            filePath: `copilot/agents/${agent.slug}/agent.md`,
            memoryPath: `copilot/agents/${agent.slug}/MEMORY.md`,
            memoryFolderPath: `copilot/agents/${agent.slug}/memory`,
            memoryBytes: 10,
          }
        : null
    ),
    appendDailyNote: jest.fn(async (slug: string, date: string, section: string) => {
      appended.push({ slug, date, section });
      return `copilot/agents/${slug}/memory/${date}.md`;
    }),
  } as unknown as AgentFileManager;

  const subSessions = {
    run: jest.fn(
      async (request: {
        backendId: string;
        prompt: { text: string }[];
        onText: (text: string) => void;
      }) => {
        backends.push(request.backendId);
        prompts.push(request.prompt[0].text);
        if (options.fail) throw options.fail;
        request.onText(options.answer ?? "- Wants the hydrogen section cut.");
        return options.outcome ?? "done";
      }
    ),
  } as unknown as ReadOnlySubSessionRunner;

  return { files, subSessions, appended, prompts, backends };
}

/** 2026-09-17 09:40 local, so the note's name and heading are timezone-independent. */
const FLUSHED_AT = new Date(2026, 8, 17, 9, 40, 0);

function run(harness: Harness, overrides: Partial<Parameters<typeof runAgentMemoryFlush>[1]> = {}) {
  return runAgentMemoryFlush(
    { files: harness.files, subSessions: harness.subSessions },
    {
      agentSlug: "jennifer",
      sessionBackendId: "claude",
      messages: TRANSCRIPT,
      chatTitle: "Newsletter rename",
      signal: new AbortController().signal,
      now: FLUSHED_AT,
      ...overrides,
    }
  );
}

describe("agentMemoryPass", () => {
  describe("runAgentMemoryFlush()", () => {
    it("appends the bullets under a heading naming the time and the chat (CUSTOM_AGENTS.md §5)", async () => {
      const harness = buildHarness();

      const outcome = await run(harness);

      expect(outcome).toEqual({
        status: "written",
        agentName: "Jennifer",
        notePath: "copilot/agents/jennifer/memory/2026-09-17.md",
        date: "2026-09-17",
      });
      expect(harness.appended).toEqual([
        {
          slug: "jennifer",
          date: "2026-09-17",
          section: "## 09:40 Newsletter rename\n\n- Wants the hydrogen section cut.\n",
        },
      ]);
    });

    it("frames the transcript as something to read rather than a question to answer", async () => {
      const harness = buildHarness();

      await run(harness);

      expect(harness.prompts[0]).toContain("do not reply to it");
      expect(harness.prompts[0]).toContain("Cut the hydrogen section.");
      expect(harness.prompts[0]).toContain("Done — it is gone.");
    });

    it("runs on the agent's pinned backend when it has one", async () => {
      const harness = buildHarness({ agent: { ...JENNIFER, backendId: "codex" } });

      await run(harness);

      expect(harness.backends).toEqual(["codex"]);
    });

    it("runs on the chat's own backend when the agent pins none", async () => {
      const harness = buildHarness();

      await run(harness);

      expect(harness.backends).toEqual(["claude"]);
    });

    it("skips a chat whose agent has been deleted (CUSTOM_AGENTS.md §1)", async () => {
      const harness = buildHarness({ agent: null });

      expect(await run(harness)).toEqual({ status: "skipped", reason: "no-agent" });
      expect(harness.subSessions.run).not.toHaveBeenCalled();
    });

    it("skips an agent whose memory toggle is off, writing nothing (CUSTOM_AGENTS.md §7)", async () => {
      const harness = buildHarness({ agent: { ...JENNIFER, memoryEnabled: false } });

      expect(await run(harness)).toEqual({ status: "skipped", reason: "memory-off" });
      expect(harness.appended).toHaveLength(0);
    });

    it("skips a conversation with no renderable turns", async () => {
      const harness = buildHarness();

      expect(await run(harness, { messages: [] })).toEqual({
        status: "skipped",
        reason: "no-turns",
      });
      expect(harness.appended).toHaveLength(0);
    });

    // designdocs/CUSTOM_AGENTS.md §5: a day of notes should read as the
    // conversations that mattered, not as one heading per exchange.
    it("leaves no heading behind when the conversation taught the agent nothing", async () => {
      const harness = buildHarness({ answer: "NOTHING" });

      expect(await run(harness)).toEqual({ status: "skipped", reason: "nothing-to-keep" });
      expect(harness.appended).toHaveLength(0);
    });

    // designdocs/CUSTOM_AGENTS.md §5: the marker advances only past turns the
    // agent actually read; a silent backend must not look like a judgement.
    it("reports a reply with no text as a failure, so the turns are flushed again later", async () => {
      const harness = buildHarness({ answer: "   " });

      expect(await run(harness)).toEqual({
        status: "failed",
        error: "Memory flush returned no text.",
      });
      expect(harness.appended).toHaveLength(0);
    });

    it("reports a backend failure as an outcome rather than throwing at the boundary", async () => {
      const harness = buildHarness({ fail: new Error("backend down") });

      expect(await run(harness)).toMatchObject({ status: "failed" });
      expect(harness.appended).toHaveLength(0);
    });

    it("writes nothing when the sub-session was aborted mid-answer", async () => {
      const harness = buildHarness({ outcome: "aborted" });

      expect(await run(harness)).toMatchObject({ status: "failed" });
      expect(harness.appended).toHaveLength(0);
    });
  });

  describe("buildFanoutMemoryTranscript()", () => {
    it("carries the question and that agent's own answer, and nothing else", () => {
      // designdocs/CUSTOM_AGENTS.md §6 — a consulted agent read only these two
      // things, so its memory must not be fed the other agents or the summary.
      const transcript = buildFanoutMemoryTranscript("Which title is better?", "Vancat here!");

      expect(transcript).toHaveLength(2);
      expect(transcript[0]).toMatchObject({
        sender: USER_SENDER,
        message: "Which title is better?",
        isVisible: true,
      });
      expect(transcript[1]).toMatchObject({ sender: AI_SENDER, message: "Vancat here!" });
      expect(transcript[0].id).not.toBe(transcript[1].id);
    });
  });
});
