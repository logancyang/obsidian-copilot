import { getSettings, resetSettings, updateSetting, type CopilotSettings } from "@/settings/model";
import {
  setDisableBuiltinSystemPrompt,
  setSelectedPromptTitle,
  updateCachedSystemPrompts,
} from "@/system-prompts/state";
import type { UserSystemPrompt } from "@/system-prompts/type";
import {
  buildAgentSystemPrompt,
  COPILOT_MIYO_DOCUMENT_STEERING,
  COPILOT_MIYO_SEARCH_STEERING,
  COPILOT_FEEDBACK_POINTER,
  COPILOT_INSTRUCTION_PRECEDENCE,
  COPILOT_PROJECT_WORKSPACE_POLICY,
  COPILOT_PROMPT_BASE,
  COPILOT_SKILL_FALLBACK,
  COPILOT_STEP_FAILURE_POLICY,
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
const ISSUE_736 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/736";
const ISSUE_717 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/717";
const ISSUE_656 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/656";
const AGENT = "opencode";
const ALL_RELAY_SKILLS_LINE =
  "For these jobs, load and run the matching Copilot skill before any built-in web tool (websearch, webfetch, WebSearch, WebFetch, web_search or similar): copilot-web-search for web search, copilot-web-fetch for pages/URLs, copilot-youtube-transcript for YouTube, copilot-fetch-x for X posts.";

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
      updateSetting("enableMiyoDocumentProcessing", false);
      resetPromptState();
    });

    it("keeps the full prompt compact without legacy agent restrictions (https://github.com/Brevilabs/obsidian-copilot-private/issues/596)", () => {
      updateSetting("enableMiyo", true);
      for (const enableMiyoDocumentProcessing of [false, true]) {
        updateSetting("enableMiyoDocumentProcessing", enableMiyoDocumentProcessing);
        for (const enableMiyoSearchSkill of [false, true]) {
          updateSetting("enableMiyoSearchSkill", enableMiyoSearchSkill);
          const prompt = buildAgentSystemPrompt(AGENT);
          expect(Buffer.byteLength(prompt, "utf8")).toBeLessThan(3700);
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

    it("tells each agent to edit vault files with its own edit tools so Copilot can show a diff (https://github.com/Brevilabs/obsidian-copilot-private/issues/701)", () => {
      expect(buildAgentSystemPrompt("claude")).toContain(
        "Edit vault files with your Edit/Write tools so Copilot shows a diff"
      );
      expect(buildAgentSystemPrompt("codex")).toContain(
        "Edit vault files with your apply_patch tools so Copilot shows a diff"
      );
      expect(buildAgentSystemPrompt("opencode")).toContain(
        "Edit vault files with your edit/write/patch tools so Copilot shows a diff"
      );
    });

    it("limits shell file writes, not other shell use, to moves, script rewrites of most of a large file, and bulk changes across dozens of files (https://github.com/Brevilabs/obsidian-copilot-private/issues/701)", () => {
      expect(buildAgentSystemPrompt(AGENT)).toContain(
        "Write via shell only to move, copy or delete files; to have a script rewrite most of a large file (sort, dedupe, recompute), not retyping it; or one mechanical change to dozens of files. Then list changed files."
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/739 tells every agent, even with the builtin prompt disabled, to write long content in small blocks and to finish the task around a cut-off, blocked or failed step", () => {
      for (const backendId of ["claude", "codex", "opencode"] as const) {
        expect(buildAgentSystemPrompt(backendId)).toContain(COPILOT_STEP_FAILURE_POLICY);
      }
      setDisableBuiltinSystemPrompt(true);
      expect(buildAgentSystemPrompt(AGENT)).toContain(COPILOT_STEP_FAILURE_POLICY);
      expect(COPILOT_STEP_FAILURE_POLICY).toContain("even if a skill says otherwise");
      expect(COPILOT_STEP_FAILURE_POLICY).toContain("skip blocked content, noting it");
    });

    it("keeps the edit-tool policy when the builtin prompt is disabled, because turn diffs depend on it (https://github.com/Brevilabs/obsidian-copilot-private/issues/701)", () => {
      setDisableBuiltinSystemPrompt(true);
      expect(buildAgentSystemPrompt(AGENT)).toContain(
        "Edit vault files with your edit/write/patch tools"
      );
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

    it("omits web search and web fetch skills under default settings https://github.com/Brevilabs/obsidian-copilot-private/issues/629", () => {
      expect(buildAgentSystemPrompt(AGENT)).toContain(
        "For these jobs, load and run the matching Copilot skill before any built-in web tool (websearch, webfetch, WebSearch, WebFetch, web_search or similar): copilot-youtube-transcript for YouTube, copilot-fetch-x for X posts."
      );
    });

    it(`names a skill disabled for one agent only in the other agents' prompts (${ISSUE_599})`, () => {
      setBuiltinPreferences({ "copilot-web-search": { disabledAgents: ["opencode"] } });

      expect(buildAgentSystemPrompt("opencode")).toContain(
        "For these jobs, load and run the matching Copilot skill before any built-in web tool (websearch, webfetch, WebSearch, WebFetch, web_search or similar): copilot-web-fetch for pages/URLs, copilot-youtube-transcript for YouTube, copilot-fetch-x for X posts."
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
      });

      const prompt = buildAgentSystemPrompt("codex");

      expect(prompt).not.toContain("copilot-");
      expect(prompt).not.toContain(COPILOT_SKILL_FALLBACK);
      expect(prompt).toContain(COPILOT_WEB_RESEARCH_STEERING);
    });

    it("includes the web research steering by default", () => {
      expect(buildAgentSystemPrompt(AGENT)).toContain(COPILOT_WEB_RESEARCH_STEERING);
    });

    it(`steers documents to miyo-parse first and lets any other tool read the file when it fails, only when Miyo document processing is on (${ISSUE_656})`, () => {
      updateSetting("enableMiyoDocumentProcessing", false);
      expect(buildAgentSystemPrompt(AGENT)).not.toContain(COPILOT_MIYO_DOCUMENT_STEERING);

      updateSetting("enableMiyoDocumentProcessing", true);
      const prompt = buildAgentSystemPrompt(AGENT);
      expect(prompt).toContain(
        "Read PDFs/EPUBs with miyo-parse first. If it is missing or fails, say so, then read the file with any other tool you have."
      );
      expect(prompt).not.toMatch(/stay local|no cloud parsers/);
    });

    it(`never steers PDFs to the retired Plus copilot-read-pdf skill (${ISSUE_656})`, () => {
      setBuiltinPreferences({});
      for (const enableMiyoDocumentProcessing of [false, true]) {
        updateSetting("enableMiyoDocumentProcessing", enableMiyoDocumentProcessing);
        expect(buildAgentSystemPrompt(AGENT)).not.toContain("copilot-read-pdf");
      }
    });

    it(`omits the miyo-parse steering for an agent whose miyo-parse skill is disabled (${ISSUE_656})`, () => {
      updateSetting("enableMiyoDocumentProcessing", true);
      setBuiltinPreferences({ "miyo-parse": { disabledAgents: ["claude"] } });

      expect(buildAgentSystemPrompt("claude")).not.toContain(COPILOT_MIYO_DOCUMENT_STEERING);
      expect(buildAgentSystemPrompt("opencode")).toContain(COPILOT_MIYO_DOCUMENT_STEERING);
    });

    it("suppresses the skill and research steering when the builtin prompt is disabled", () => {
      setDisableBuiltinSystemPrompt(true);
      const prompt = buildAgentSystemPrompt(AGENT);
      expect(prompt).not.toContain(COPILOT_SKILL_FALLBACK);
      expect(prompt).not.toContain(COPILOT_WEB_RESEARCH_STEERING);
    });

    it(`omits the Miyo steering and any mention of miyo_search when the search switch is off (${ISSUE_736})`, () => {
      updateSetting("enableMiyo", true);
      updateSetting("enableMiyoSearchSkill", false);
      const prompt = buildAgentSystemPrompt(AGENT);
      expect(prompt).not.toContain(COPILOT_MIYO_SEARCH_STEERING);
      expect(prompt).not.toContain("miyo_search");
    });

    it(`appends the Miyo steering for every agent when the search switch is on (${ISSUE_736})`, () => {
      updateSetting("enableMiyo", true);
      updateSetting("enableMiyoSearchSkill", true);
      for (const agent of ["claude", "codex", "opencode"] as const) {
        expect(buildAgentSystemPrompt(agent)).toContain(COPILOT_MIYO_SEARCH_STEERING);
      }
    });

    it("omits the Miyo steering while Miyo is disconnected even though the search switch defaults on (https://github.com/Brevilabs/obsidian-copilot-private/issues/716)", () => {
      updateSetting("enableMiyo", false);
      updateSetting("enableMiyoSearchSkill", true);
      const prompt = buildAgentSystemPrompt(AGENT);
      expect(prompt).not.toContain(COPILOT_MIYO_SEARCH_STEERING);
      expect(prompt).not.toContain("miyo_search");
    });

    it(`names the obsidian-copilot miyo_search tool and grep/glob for exact terms, for every request the notes might answer, even an external-sounding one (${ISSUE_736})`, () => {
      updateSetting("enableMiyo", true);
      updateSetting("enableMiyoSearchSkill", true);
      const prompt = buildAgentSystemPrompt(AGENT);
      expect(prompt).toContain(
        "For any request that may be answered from the user's notes, even one that sounds external or current, call the obsidian-copilot miyo_search tool and also grep/glob for any exact names, terms, tags or quoted phrases in the request."
      );
      expect(prompt).not.toContain("miyo-search");
      expect(prompt).not.toContain("when grep is too slow");
    });

    it(`tells the agent to search the vault with miyo_search, not the miyo CLI or another Miyo skill (${ISSUE_736})`, () => {
      updateSetting("enableMiyo", true);
      updateSetting("enableMiyoSearchSkill", true);
      expect(buildAgentSystemPrompt(AGENT)).toContain(
        "Search the vault with miyo_search, not the miyo CLI or another Miyo skill."
      );
    });

    it(`merges both result sets by note path and opens the strongest matches before answering (${ISSUE_717})`, () => {
      updateSetting("enableMiyo", true);
      updateSetting("enableMiyoSearchSkill", true);
      const prompt = buildAgentSystemPrompt(AGENT);
      expect(prompt).toContain(
        "Merge the results by note path and open the strongest matches before answering."
      );
    });

    it(`says the vault does not cover a request when neither search finds support, then searches the web for external topics (${ISSUE_717})`, () => {
      updateSetting("enableMiyo", true);
      updateSetting("enableMiyoSearchSkill", true);
      const prompt = buildAgentSystemPrompt(AGENT);
      expect(prompt).toContain(
        "If neither finds support, say the vault does not cover it; for external topics, then search the web."
      );
    });

    it(`ignores a saved per-agent miyo-search opt-out, because the switch alone controls Miyo search (${ISSUE_736})`, () => {
      updateSetting("enableMiyo", true);
      updateSetting("enableMiyoSearchSkill", true);
      setBuiltinPreferences({ "miyo-search": { disabledAgents: ["codex"] } });

      expect(buildAgentSystemPrompt("codex")).toContain(COPILOT_MIYO_SEARCH_STEERING);
      expect(buildAgentSystemPrompt("claude")).toContain(COPILOT_MIYO_SEARCH_STEERING);
    });

    it("suppresses the Miyo steering when the builtin prompt is disabled, even if the search switch is on", () => {
      updateSetting("enableMiyo", true);
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

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 points the agent at send_feedback while feedback cards are on, even with the builtin prompt disabled", () => {
      expect(buildAgentSystemPrompt(AGENT)).toContain(COPILOT_FEEDBACK_POINTER);
      setDisableBuiltinSystemPrompt(true);
      expect(buildAgentSystemPrompt(AGENT)).toContain(COPILOT_FEEDBACK_POINTER);
    });

    it("drops the send_feedback pointer when the user turns feedback cards off", () => {
      updateSetting("agentMode", { ...getSettings().agentMode, offerFeedbackCards: false });
      expect(buildAgentSystemPrompt(AGENT)).not.toContain(COPILOT_FEEDBACK_POINTER);
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
