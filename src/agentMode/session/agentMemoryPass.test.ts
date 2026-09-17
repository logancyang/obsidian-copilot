import type { AgentFileManager } from "@/agents/AgentFileManager";
import { AGENT_MEMORY_HEADINGS } from "@/agents/agentFile";
import type { CustomAgent } from "@/agents/types";
import {
  buildFanoutMemoryTranscript,
  runAgentMemoryPass,
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
  memoryEnabled: true,
  created: "2026-09-16T10:00:00Z",
  instructions: "You are Jennifer.",
};

function memoryFile(entry = "- (2026-09-10) Writes a weekly newsletter."): string {
  return [
    "# Jennifer's memory",
    "",
    ...AGENT_MEMORY_HEADINGS.flatMap((heading) => [`## ${heading}`, entry, ""]),
  ].join("\n");
}

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
  written: { slug: string; text: string }[];
  prompts: string[];
  backends: string[];
}

function buildHarness(options: {
  agent?: CustomAgent | null;
  stored?: string | null;
  answer?: string;
  fail?: Error;
  outcome?: "done" | "aborted";
}): Harness {
  const written: { slug: string; text: string }[] = [];
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
            memoryBytes: 10,
          }
        : null
    ),
    readMemoryDocument: jest.fn(async () =>
      options.stored === null || options.stored === undefined
        ? null
        : { text: options.stored, modifiedAtMs: 0 }
    ),
    writeMemory: jest.fn(async (slug: string, text: string) => {
      written.push({ slug, text });
      return `copilot/agents/${slug}/MEMORY.md`;
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
        request.onText(options.answer ?? memoryFile("- (2026-09-17) Cut hydrogen."));
        return options.outcome ?? "done";
      }
    ),
  } as unknown as ReadOnlySubSessionRunner;

  return { files, subSessions, written, prompts, backends };
}

function run(harness: Harness, overrides: Partial<Parameters<typeof runAgentMemoryPass>[1]> = {}) {
  return runAgentMemoryPass(
    { files: harness.files, subSessions: harness.subSessions },
    {
      agentSlug: "jennifer",
      sessionBackendId: "claude",
      messages: TRANSCRIPT,
      signal: new AbortController().signal,
      ...overrides,
    }
  );
}

describe("agentMemoryPass", () => {
  describe("runAgentMemoryPass()", () => {
    it("writes the file the agent returned and reports who wrote it", async () => {
      const harness = buildHarness({ stored: memoryFile() });

      const outcome = await run(harness);

      expect(outcome).toEqual({
        status: "written",
        agentName: "Jennifer",
        memoryPath: "copilot/agents/jennifer/MEMORY.md",
      });
      expect(harness.written).toHaveLength(1);
      expect(harness.written[0].text).toContain("Cut hydrogen.");
    });

    it("reads MEMORY.md from disk at pass time, so a user's own edit is the baseline (CUSTOM_AGENTS.md §5)", async () => {
      const harness = buildHarness({ stored: memoryFile("- (2026-09-16) Edited by hand.") });

      await run(harness);

      expect(harness.prompts[0]).toContain("Edited by hand.");
    });

    it("frames the transcript as a finished conversation rather than a question to answer", async () => {
      const harness = buildHarness({ stored: memoryFile() });

      await run(harness);

      expect(harness.prompts[0]).toContain("do not reply to it");
      expect(harness.prompts[0]).toContain("Cut the hydrogen section.");
      expect(harness.prompts[0]).toContain("Done — it is gone.");
    });

    it("runs on the agent's pinned backend when it has one", async () => {
      const harness = buildHarness({
        agent: { ...JENNIFER, backendId: "codex" },
        stored: memoryFile(),
      });

      await run(harness);

      expect(harness.backends).toEqual(["codex"]);
    });

    it("runs on the chat's own backend when the agent pins none", async () => {
      const harness = buildHarness({ stored: memoryFile() });

      await run(harness);

      expect(harness.backends).toEqual(["claude"]);
    });

    it("skips a chat whose agent has been deleted (CUSTOM_AGENTS.md §1)", async () => {
      const harness = buildHarness({ agent: null });

      expect(await run(harness)).toEqual({ status: "skipped", reason: "no-agent" });
      expect(harness.subSessions.run).not.toHaveBeenCalled();
    });

    it("skips an agent whose memory toggle is off, writing and reading nothing (CUSTOM_AGENTS.md §7)", async () => {
      const harness = buildHarness({ agent: { ...JENNIFER, memoryEnabled: false } });

      expect(await run(harness)).toEqual({ status: "skipped", reason: "memory-off" });
      expect(harness.files.readMemoryDocument).not.toHaveBeenCalled();
      expect(harness.written).toHaveLength(0);
    });

    it("skips a conversation with no renderable turns", async () => {
      const harness = buildHarness({ stored: memoryFile() });

      expect(await run(harness, { messages: [] })).toEqual({
        status: "skipped",
        reason: "no-turns",
      });
    });

    it("starts from the empty skeleton when the memory file was deleted by hand", async () => {
      const harness = buildHarness({ stored: null });

      await run(harness);

      expect(harness.prompts[0]).toContain("# Jennifer's memory");
      for (const heading of AGENT_MEMORY_HEADINGS) expect(harness.prompts[0]).toContain(heading);
    });

    it("keeps the old file when the answer fails the safety rails (CUSTOM_AGENTS.md §5)", async () => {
      const harness = buildHarness({ stored: memoryFile(), answer: "  " });

      expect(await run(harness)).toEqual({ status: "rejected", reason: "empty" });
      expect(harness.written).toHaveLength(0);
    });

    it("reports a backend failure as an outcome rather than throwing at the boundary", async () => {
      const harness = buildHarness({ stored: memoryFile(), fail: new Error("backend down") });

      expect(await run(harness)).toMatchObject({ status: "failed" });
      expect(harness.written).toHaveLength(0);
    });

    it("writes nothing when the sub-session was aborted mid-answer", async () => {
      const harness = buildHarness({ stored: memoryFile(), outcome: "aborted" });

      expect(await run(harness)).toMatchObject({ status: "failed" });
      expect(harness.written).toHaveLength(0);
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
