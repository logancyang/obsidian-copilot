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

/** The system-prompt jotai store is independent of settings — reset it explicitly. */
function resetPromptState(): void {
  setDisableBuiltinSystemPrompt(false);
  setSelectedPromptTitle("");
  updateSetting("defaultSystemPromptTitle", "");
  updateCachedSystemPrompts([]);
}

describe("agentSystemPrompt", () => {
  describe("buildAgentSystemPrompt(AGENT)", () => {
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

    it("does not copy Chat mode custom prompts into the Agent Mode system prompt", () => {
      updateCachedSystemPrompts([makePrompt("Haiku", "respond in haiku")]);
      setSelectedPromptTitle("Haiku");
      updateSetting("defaultSystemPromptTitle", "Haiku");

      const prompt = buildAgentSystemPrompt(AGENT);

      expect(prompt).not.toContain("respond in haiku");
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
      // Operational wiring (where the agent may write and read), not builtin framing — and
      // pre-AGENTS.md it rode the project mirror / <project_instructions>, which the toggle
      // never suppressed. Losing it would let a project session scatter output anywhere.
      expect(buildAgentSystemPrompt(AGENT)).toContain(COPILOT_PROJECT_WORKSPACE_POLICY);
      setDisableBuiltinSystemPrompt(true);
      expect(buildAgentSystemPrompt(AGENT)).toContain(COPILOT_PROJECT_WORKSPACE_POLICY);
      expect(COPILOT_PROJECT_WORKSPACE_POLICY).toContain("outputs/");
      expect(COPILOT_PROJECT_WORKSPACE_POLICY).toContain("configured context sources");
      expect(COPILOT_PROJECT_WORKSPACE_POLICY).toContain(
        "unless the user specifies another destination"
      );
      expect(COPILOT_PROJECT_WORKSPACE_POLICY).toContain("including external sources");
      expect(COPILOT_PROJECT_WORKSPACE_POLICY).toContain(
        "read → <absolute path> snapshots directly"
      );
      expect(COPILOT_PROJECT_WORKSPACE_POLICY).toContain(
        "only when instructions or the user name them"
      );
    });

    it("steers every agent to the enabled Copilot relay skills first, regardless of Plus status", () => {
      // Default settings → NOT a Plus user; the skills still run first and their
      // scripts route an unlicensed user to the agent's own tools.
      for (const agent of ["claude", "codex", "opencode"]) {
        const prompt = buildAgentSystemPrompt(agent);
        expect(prompt).toContain(`${ALL_RELAY_SKILLS_LINE} ${COPILOT_SKILL_FALLBACK}`);
      }
      // Built-in tools are the fallback only when the skill itself says it can't
      // serve the request, so the request never dead-ends or blocks a free user.
      expect(COPILOT_SKILL_FALLBACK).toContain(
        "Call an equivalent built-in tool only after the skill reports it is unavailable or fails"
      );
      expect(COPILOT_SKILL_FALLBACK).toContain("if none exists, say it's unavailable");
      expect(COPILOT_SKILL_FALLBACK).toMatch(/Never block on upgrading/);
      expect(COPILOT_SKILL_FALLBACK).toContain(
        "briefly and occasionally only when the skill explicitly invites it"
      );

      const nonPlus = buildAgentSystemPrompt(AGENT);
      updateSetting("isPaidUser", true);
      expect(buildAgentSystemPrompt(AGENT)).toBe(nonPlus);
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

    it("routes external questions to the web proactively and keeps vault text out of queries", () => {
      const prompt = buildAgentSystemPrompt(AGENT);
      expect(prompt).toContain(COPILOT_WEB_RESEARCH_STEERING);
      // Both halves of the routing rule, plus the privacy constraint on queries.
      expect(prompt).toMatch(/search locally first/i);
      expect(prompt).toMatch(
        /Proactively search\/fetch current facts, external topics and third-party docs/i
      );
      expect(prompt).toMatch(/Do not place vault text in web queries/i);
    });

    it("uses the local fail-closed document route only when Miyo is selected", () => {
      expect(buildAgentSystemPrompt(AGENT)).not.toContain(COPILOT_MIYO_DOCUMENT_STEERING);

      updateSetting("docProcessorBackend", "miyo");
      const prompt = buildAgentSystemPrompt(AGENT);
      expect(prompt).toContain(COPILOT_MIYO_DOCUMENT_STEERING);
      // The Plus route must be absent, not merely outranked: `copilot-read-pdf` is
      // pruned from disk in this mode, so steering toward it would dead-end.
      expect(prompt).not.toContain("copilot-read-pdf for PDFs");
      expect(prompt).toContain("miyo-parse");
      // Cancels the equivalent-tool fallback the relay steering sets up.
      expect(prompt).toMatch(/report and stop: no fallback/i);
      expect(prompt).toContain("PDFs/EPUBs must stay local");
      expect(prompt).toContain("cloud parsers or web services");
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
      // Names the skill and gives concrete triggers for when to call it.
      expect(prompt).toContain("miyo-search");
      expect(prompt).toMatch(/too slow|too few relevant/i);
      expect(prompt).toMatch(/explicitly requested/i);
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

    // The cache contract: this string is a provider cache prefix, so anything that is not
    // product source or a product capability toggle must leave it byte-identical. `toBe`,
    // not `toContain` — a containment assertion still passes while extra bytes shift
    // everything after it out of the cached prefix.
    it("emits identical bytes no matter which Chat prompt is selected", () => {
      const baseline = buildAgentSystemPrompt(AGENT);

      updateCachedSystemPrompts([makePrompt("Haiku", "respond in haiku")]);
      setSelectedPromptTitle("Haiku");
      updateSetting("defaultSystemPromptTitle", "Haiku");

      expect(buildAgentSystemPrompt(AGENT)).toBe(baseline);
    });

    it("emits identical bytes across vaults, projects, models and sessions", () => {
      const baseline = buildAgentSystemPrompt(AGENT);

      // Everything a session carries that is not product configuration. None of these is an
      // argument to the builder today; this asserts none of them becomes one.
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
    it("establishes Obsidian Copilot identity and vault workspace", () => {
      expect(COPILOT_PROMPT_BASE).toMatch(/Obsidian Copilot/);
      expect(COPILOT_PROMPT_BASE).toMatch(/vault or project workspace/);
      expect(COPILOT_PROMPT_BASE).toContain("not a CLI coding agent");
      expect(COPILOT_PROMPT_BASE).toContain("tags usually mean Obsidian note properties");
      expect(COPILOT_PROMPT_BASE).toContain("Read notes before describing their contents");
      expect(COPILOT_PROMPT_BASE).toContain("Report uncertainty and access/tool failures honestly");
      expect(COPILOT_PROMPT_BASE).toContain("detail appropriate to the task");
    });

    it("does not carry chat-mode-only baggage that misfires in tool-driven agents", () => {
      expect(COPILOT_PROMPT_BASE).not.toMatch(/@vault/);
      expect(COPILOT_PROMPT_BASE).not.toMatch(/getCurrentTime/);
      expect(COPILOT_PROMPT_BASE).not.toMatch(/getTimeRangeMs/);
      expect(COPILOT_PROMPT_BASE).not.toMatch(/YouTube/);
    });

    it("keeps Obsidian note and image syntax without generic formatting tutorials", () => {
      expect(COPILOT_PROMPT_BASE).toContain("[[title]] for note titles");
      expect(COPILOT_PROMPT_BASE).toContain("![[link]] for vault images");
      expect(COPILOT_PROMPT_BASE).toContain("![alt](url) for web images");
      expect(COPILOT_PROMPT_BASE).toContain("never wrap links in backticks");
    });

    it("retains the LaTeX formatting rule", () => {
      expect(COPILOT_PROMPT_BASE).toMatch(/\$\.\.\.\$/);
    });
  });
});
