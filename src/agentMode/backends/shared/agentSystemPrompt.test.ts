import { getSettings, resetSettings, updateSetting, type CopilotSettings } from "@/settings/model";
import {
  setDisableBuiltinSystemPrompt,
  setSelectedPromptTitle,
  updateCachedSystemPrompts,
} from "@/system-prompts/state";
import type { UserSystemPrompt } from "@/system-prompts/type";
import {
  buildAgentSystemPrompt,
  COPILOT_AGENT_PERSONA_POLICY,
  COPILOT_MIYO_DOCUMENT_STEERING,
  COPILOT_MIYO_SEARCH_STEERING,
  COPILOT_INSTRUCTION_PRECEDENCE,
  COPILOT_PROJECT_WORKSPACE_POLICY,
  COPILOT_PROMPT_BASE,
  COPILOT_SKILL_FALLBACK,
  COPILOT_WEB_RESEARCH_STEERING,
} from "./agentSystemPrompt";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

function makePrompt(title: string, content: string): UserSystemPrompt {
  return { title, content, createdMs: 0, modifiedMs: 0, lastUsedMs: 0 };
}

const ISSUE_599 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/599";
const AGENT = "opencode";
const ALL_RELAY_SKILLS_LINE =
  "For these jobs, load and run the matching Copilot skill before any built-in web tool (websearch, webfetch, WebSearch, WebFetch, web_search or similar): copilot-web-search for web search, copilot-web-fetch for pages/URLs, copilot-youtube-transcript for YouTube, copilot-fetch-x for X posts, copilot-read-pdf for PDFs.";

function setBuiltinPreferences(
  builtinPreferences: NonNullable<CopilotSettings["agentMode"]["skills"]["builtinPreferences"]>
): void {
  const agentMode = getSettings().agentMode;
  updateSetting("agentMode", { ...agentMode, skills: { ...agentMode.skills, builtinPreferences } });
}

function resetPromptState(): void {
  setDisableBuiltinSystemPrompt(false);
  setSelectedPromptTitle("");
  updateSetting("defaultSystemPromptTitle", "");
  updateCachedSystemPrompts([]);
}

describe("agentSystemPrompt", () => {
  describe("buildAgentSystemPrompt()", () => {
    beforeEach(() => {
      resetSettings();
      resetPromptState();
    });

    it("keeps the full prompt compact without legacy agent restrictions (https://github.com/Brevilabs/obsidian-copilot-private/issues/596)", () => {
      for (const docProcessorBackend of ["plus", "miyo"] as const) {
        updateSetting("docProcessorBackend", docProcessorBackend);
        for (const enableMiyoSearchSkill of [false, true]) {
          updateSetting("enableMiyoSearchSkill", enableMiyoSearchSkill);
          const prompt = buildAgentSystemPrompt(AGENT);
          expect(Buffer.byteLength(prompt, "utf8")).toBeLessThan(3000);
          expect(prompt).not.toMatch(
            /NEVER search for the same|After 1-2 searches|Never claim you do not have access|delimiter row of dashes|## Task planning/
          );
        }
      }
    });

    it("includes the Copilot base prompt and the pill-syntax directive by default", () => {
      const prompt = buildAgentSystemPrompt(AGENT);
      expect(prompt.startsWith(COPILOT_PROMPT_BASE)).toBe(true);
      expect(prompt).toContain("{folder_name}");
      expect(prompt).toContain("{activeNote}");
      expect(prompt).not.toContain("<user_custom_instructions>");
    });

    it("suppresses the base prompt when 'disable builtin' is on, keeping the pill directive", () => {
      setDisableBuiltinSystemPrompt(true);
      const prompt = buildAgentSystemPrompt(AGENT);
      expect(prompt).not.toContain(COPILOT_PROMPT_BASE);
      expect(prompt).not.toContain("You are Obsidian Copilot");
      expect(prompt).toContain("{folder_name}");
    });

    it("keeps the project workspace policy internal and always on", () => {
      expect(buildAgentSystemPrompt(AGENT)).toContain(COPILOT_PROJECT_WORKSPACE_POLICY);
      setDisableBuiltinSystemPrompt(true);
      expect(buildAgentSystemPrompt(AGENT)).toContain(COPILOT_PROJECT_WORKSPACE_POLICY);
    });

    it("steers every agent to the enabled Copilot relay skills first, regardless of Plus status", () => {
      setBuiltinPreferences({});
      for (const agent of ["claude", "codex", "opencode"]) {
        const prompt = buildAgentSystemPrompt(agent);
        expect(prompt).toContain(`${ALL_RELAY_SKILLS_LINE} ${COPILOT_SKILL_FALLBACK}`);
      }

      const nonPlus = buildAgentSystemPrompt(AGENT);
      updateSetting("isPaidUser", true);
      expect(buildAgentSystemPrompt(AGENT)).toBe(nonPlus);
    });

    it("omits web search, web fetch, and PDF skills under default settings https://github.com/Brevilabs/obsidian-copilot-private/issues/629", () => {
      expect(buildAgentSystemPrompt(AGENT)).toContain(
        "For these jobs, load and run the matching Copilot skill before any built-in web tool (websearch, webfetch, WebSearch, WebFetch, web_search or similar): copilot-youtube-transcript for YouTube, copilot-fetch-x for X posts."
      );
    });

    it(`names a skill disabled for one agent only in the other agents' prompts (${ISSUE_599})`, () => {
      setBuiltinPreferences({ "copilot-web-search": { disabledAgents: ["opencode"] } });

      expect(buildAgentSystemPrompt("opencode")).toContain(
        "For these jobs, load and run the matching Copilot skill before any built-in web tool (websearch, webfetch, WebSearch, WebFetch, web_search or similar): copilot-web-fetch for pages/URLs, copilot-youtube-transcript for YouTube, copilot-fetch-x for X posts, copilot-read-pdf for PDFs."
      );
      expect(buildAgentSystemPrompt("opencode")).not.toContain("copilot-web-search");
      expect(buildAgentSystemPrompt("claude")).toContain(ALL_RELAY_SKILLS_LINE);
      expect(buildAgentSystemPrompt("codex")).toContain(ALL_RELAY_SKILLS_LINE);
    });

    it(`omits the skill line but keeps vault-first research guidance when no relay skill is enabled for the agent (${ISSUE_599})`, () => {
      setBuiltinPreferences({
        "copilot-web-search": { disabled: true },
        "copilot-web-fetch": { disabled: true },
        "copilot-youtube-transcript": { disabledAgents: ["codex"] },
        "copilot-fetch-x": { disabledAgents: ["codex"] },
        "copilot-read-pdf": { disabledAgents: ["codex"] },
      });

      const prompt = buildAgentSystemPrompt("codex");

      expect(prompt).not.toContain("copilot-");
      expect(prompt).not.toContain(COPILOT_SKILL_FALLBACK);
      expect(prompt).toContain(COPILOT_WEB_RESEARCH_STEERING);
    });

    it("includes the web research steering by default", () => {
      expect(buildAgentSystemPrompt(AGENT)).toContain(COPILOT_WEB_RESEARCH_STEERING);
    });

    it("uses the local fail-closed document route only when Miyo is selected", () => {
      expect(buildAgentSystemPrompt(AGENT)).not.toContain(COPILOT_MIYO_DOCUMENT_STEERING);

      updateSetting("docProcessorBackend", "miyo");
      const prompt = buildAgentSystemPrompt(AGENT);
      expect(prompt).toContain(COPILOT_MIYO_DOCUMENT_STEERING);
      expect(prompt).not.toContain("copilot-read-pdf for PDFs");
    });

    it(`keeps the Miyo stay-local rule for an agent whose miyo-parse skill is disabled (${ISSUE_599})`, () => {
      updateSetting("docProcessorBackend", "miyo");
      setBuiltinPreferences({ "miyo-parse": { disabledAgents: ["claude"] } });

      expect(buildAgentSystemPrompt("claude")).toContain(COPILOT_MIYO_DOCUMENT_STEERING);
      expect(buildAgentSystemPrompt("opencode")).toContain(COPILOT_MIYO_DOCUMENT_STEERING);
    });

    it("suppresses the skill and research steering when the builtin prompt is disabled", () => {
      setDisableBuiltinSystemPrompt(true);
      const prompt = buildAgentSystemPrompt(AGENT);
      expect(prompt).not.toContain(COPILOT_SKILL_FALLBACK);
      expect(prompt).not.toContain(COPILOT_WEB_RESEARCH_STEERING);
    });

    it("omits the Miyo steering when the search skill is not installed", () => {
      updateSetting("enableMiyoSearchSkill", false);
      const prompt = buildAgentSystemPrompt(AGENT);
      expect(prompt).not.toContain(COPILOT_MIYO_SEARCH_STEERING);
      expect(prompt).not.toContain("miyo-search");
    });

    it("appends the Miyo steering only when the search skill is enabled", () => {
      updateSetting("enableMiyoSearchSkill", true);
      const prompt = buildAgentSystemPrompt(AGENT);
      expect(prompt).toContain(COPILOT_MIYO_SEARCH_STEERING);
    });

    it(`omits the Miyo search steering for an agent whose miyo-search skill is disabled (${ISSUE_599})`, () => {
      updateSetting("enableMiyoSearchSkill", true);
      setBuiltinPreferences({ "miyo-search": { disabledAgents: ["codex"] } });

      expect(buildAgentSystemPrompt("codex")).not.toContain(COPILOT_MIYO_SEARCH_STEERING);
      expect(buildAgentSystemPrompt("claude")).toContain(COPILOT_MIYO_SEARCH_STEERING);
    });

    it("suppresses the Miyo steering when the builtin prompt is disabled, even if the skill is enabled", () => {
      updateSetting("enableMiyoSearchSkill", true);
      setDisableBuiltinSystemPrompt(true);
      const prompt = buildAgentSystemPrompt(AGENT);
      expect(prompt).not.toContain(COPILOT_MIYO_SEARCH_STEERING);
    });

    it("never copies user-authored project instructions or context payloads", () => {
      const prompt = buildAgentSystemPrompt(AGENT);
      expect(prompt).not.toContain("<project_instructions>");
      expect(prompt).not.toMatch(/<project_context>[\s\S]*<\/project_context>/);
    });

    it("tells the agent that a project AGENTS.md outranks the vault one", () => {
      expect(buildAgentSystemPrompt(AGENT)).toContain(COPILOT_INSTRUCTION_PRECEDENCE);
    });

    it("keeps the precedence rule through the builtin toggle, like the workspace policy", () => {
      setDisableBuiltinSystemPrompt(true);
      expect(buildAgentSystemPrompt(AGENT)).toContain(COPILOT_INSTRUCTION_PRECEDENCE);
    });

    it("tells the agent to adopt an <agent_persona> block and trust <agent_memory>", () => {
      const prompt = buildAgentSystemPrompt(AGENT);
      expect(prompt).toContain(COPILOT_AGENT_PERSONA_POLICY);
      expect(prompt).toContain("<agent_persona");
      expect(prompt).toContain("<agent_memory>");
    });

    it("keeps the persona policy through the builtin toggle and names no specific agent", () => {
      setDisableBuiltinSystemPrompt(true);
      expect(buildAgentSystemPrompt(AGENT)).toContain(COPILOT_AGENT_PERSONA_POLICY);
      expect(COPILOT_AGENT_PERSONA_POLICY).not.toMatch(/Jennifer/);
    });

    it("subordinates a persona to safety and tool policy, not to the generic framing", () => {
      expect(COPILOT_AGENT_PERSONA_POLICY).toMatch(/the block wins/i);
      expect(COPILOT_AGENT_PERSONA_POLICY).toMatch(/neither block overrides your safety/i);
    });

    it("emits identical bytes no matter which Chat prompt is selected", () => {
      const baseline = buildAgentSystemPrompt(AGENT);

      updateCachedSystemPrompts([makePrompt("Haiku", "respond in haiku")]);
      setSelectedPromptTitle("Haiku");
      updateSetting("defaultSystemPromptTitle", "Haiku");

      expect(buildAgentSystemPrompt(AGENT)).toBe(baseline);
    });

    it("emits identical bytes across vaults, projects, models and sessions", () => {
      const baseline = buildAgentSystemPrompt(AGENT);

      updateSetting("defaultModelKey", "some-other-model|anthropic");
      updateSetting("projectsFolder", "vault-b/projects");
      updateSetting("defaultSaveFolder", "vault-b/chats");

      expect(buildAgentSystemPrompt(AGENT)).toBe(baseline);
    });

    it("carries no vault path, date, model id or session id", () => {
      const prompt = buildAgentSystemPrompt(AGENT);

      expect(prompt).not.toMatch(/\/Users\/|[A-Z]:\\/);
      expect(prompt).not.toMatch(/\b20\d{2}-\d{2}-\d{2}\b/);
      expect(prompt).not.toMatch(/\bsession[-_ ]?id\b/i);
    });
  });

  describe("COPILOT_PROMPT_BASE", () => {
    it("does not carry chat-mode-only baggage that misfires in tool-driven agents", () => {
      expect(COPILOT_PROMPT_BASE).not.toMatch(/@vault/);
      expect(COPILOT_PROMPT_BASE).not.toMatch(/getCurrentTime/);
      expect(COPILOT_PROMPT_BASE).not.toMatch(/getTimeRangeMs/);
      expect(COPILOT_PROMPT_BASE).not.toMatch(/YouTube/);
    });
  });
});
