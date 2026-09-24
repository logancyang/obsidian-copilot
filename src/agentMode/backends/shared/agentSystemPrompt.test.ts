import { resetSettings, updateSetting } from "@/settings/model";
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
  COPILOT_PLUS_DOCUMENT_STEERING,
  COPILOT_INSTRUCTION_PRECEDENCE,
  COPILOT_PROJECT_WORKSPACE_POLICY,
  COPILOT_PLUS_TOOLS_STEERING,
  COPILOT_PROMPT_BASE,
} from "./agentSystemPrompt";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

function makePrompt(title: string, content: string): UserSystemPrompt {
  return { title, content, createdMs: 0, modifiedMs: 0, lastUsedMs: 0 };
}

/** The system-prompt jotai store is independent of settings — reset it explicitly. */
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
          const prompt = buildAgentSystemPrompt();
          expect(Buffer.byteLength(prompt, "utf8")).toBeLessThan(3000);
          expect(prompt).not.toMatch(
            /NEVER search for the same|After 1-2 searches|Never claim you do not have access|delimiter row of dashes|## Task planning/
          );
        }
      }
    });

    it("includes the Copilot base prompt and the pill-syntax directive by default", () => {
      const prompt = buildAgentSystemPrompt();
      expect(prompt.startsWith(COPILOT_PROMPT_BASE)).toBe(true);
      expect(prompt).toContain("{folder_name}");
      expect(prompt).toContain("{activeNote}");
      expect(prompt).not.toContain("<user_custom_instructions>");
    });

    it("does not copy Chat mode custom prompts into the Agent Mode system prompt", () => {
      updateCachedSystemPrompts([makePrompt("Haiku", "respond in haiku")]);
      setSelectedPromptTitle("Haiku");
      updateSetting("defaultSystemPromptTitle", "Haiku");

      const prompt = buildAgentSystemPrompt();

      expect(prompt).not.toContain("respond in haiku");
      expect(prompt).not.toContain("<user_custom_instructions>");
    });

    it("suppresses the base prompt when 'disable builtin' is on, keeping the pill directive", () => {
      setDisableBuiltinSystemPrompt(true);
      const prompt = buildAgentSystemPrompt();
      expect(prompt).not.toContain(COPILOT_PROMPT_BASE);
      expect(prompt).not.toContain("You are Obsidian Copilot");
      expect(prompt).toContain("{folder_name}");
    });

    it("keeps the project workspace policy internal and always on", () => {
      // Operational wiring (where the agent may write and read), not builtin framing — and
      // pre-AGENTS.md it rode the project mirror / <project_instructions>, which the toggle
      // never suppressed. Losing it would let a project session scatter output anywhere.
      expect(buildAgentSystemPrompt()).toContain(COPILOT_PROJECT_WORKSPACE_POLICY);
      setDisableBuiltinSystemPrompt(true);
      expect(buildAgentSystemPrompt()).toContain(COPILOT_PROJECT_WORKSPACE_POLICY);
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

    it("steers toward the builtin Copilot Plus skills regardless of Plus status", () => {
      // Default settings → NOT a Plus user; steering must still be present so a
      // users fall back to their own tools via the steering's fallback clause.
      const nonPlus = buildAgentSystemPrompt();
      expect(nonPlus).toContain(COPILOT_PLUS_TOOLS_STEERING);
      expect(nonPlus).toContain("copilot-web-search");
      expect(nonPlus).toContain("copilot-web-fetch");
      expect(nonPlus).toContain("copilot-read-pdf");
      expect(nonPlus).toContain("copilot-youtube-transcript");
      expect(nonPlus).toContain("copilot-fetch-x");
      // Fallback clause so a missing/unlicensed skill never dead-ends or blocks
      // a free user — it routes the agent to its own equivalent tool instead.
      expect(nonPlus).toMatch(/silently use an equivalent tool/i);
      expect(nonPlus).toMatch(/Never block on upgrading/i);
      // Fallback also covers a skill that runs but fails for this request (e.g. a
      // page the relay can't fetch), so a single bad input doesn't dead-end it.
      expect(nonPlus).toMatch(/or fails/i);
      expect(nonPlus).toContain("if none exists, say it's unavailable");
      expect(nonPlus).toContain(
        "briefly and occasionally only when the skill explicitly invites it"
      );

      // A Plus user gets the same steering.
      updateSetting("isPaidUser", true);
      expect(buildAgentSystemPrompt()).toContain(COPILOT_PLUS_TOOLS_STEERING);
    });

    it("routes external questions to the web proactively and keeps vault text out of queries", () => {
      const prompt = buildAgentSystemPrompt();
      // Both halves of the routing rule, plus the privacy constraint on queries.
      expect(prompt).toMatch(/search locally first/i);
      expect(prompt).toMatch(
        /Proactively search\/fetch current facts, external topics and third-party docs/i
      );
      expect(prompt).toMatch(/Do not place vault text in web queries/i);
    });

    it("uses the local fail-closed document route only when Miyo is selected", () => {
      updateSetting("docProcessorBackend", "miyo");
      const prompt = buildAgentSystemPrompt();
      expect(prompt).toContain(COPILOT_MIYO_DOCUMENT_STEERING);
      // The Plus route must be absent, not merely outranked: `copilot-read-pdf` is
      // pruned from disk in this mode, so steering toward it would dead-end.
      expect(prompt).not.toContain(COPILOT_PLUS_DOCUMENT_STEERING);
      expect(prompt).toContain("miyo-parse");
      // Cancels the blanket fallback clause the Plus tools steering sets up.
      expect(prompt).toMatch(/report and stop: no fallback/i);
      expect(prompt).toContain("PDFs/EPUBs must stay local");
      expect(prompt).toContain("cloud parsers or web services");
    });

    it("suppresses the steering when the builtin prompt is disabled", () => {
      setDisableBuiltinSystemPrompt(true);
      const prompt = buildAgentSystemPrompt();
      expect(prompt).not.toContain(COPILOT_PLUS_TOOLS_STEERING);
    });

    it("omits the Miyo steering when the search skill is not installed", () => {
      updateSetting("enableMiyoSearchSkill", false);
      const prompt = buildAgentSystemPrompt();
      expect(prompt).not.toContain(COPILOT_MIYO_SEARCH_STEERING);
      expect(prompt).not.toContain("miyo-search");
    });

    it("appends the Miyo steering only when the search skill is enabled", () => {
      updateSetting("enableMiyoSearchSkill", true);
      const prompt = buildAgentSystemPrompt();
      expect(prompt).toContain(COPILOT_MIYO_SEARCH_STEERING);
      // Names the skill and gives concrete triggers for when to call it.
      expect(prompt).toContain("miyo-search");
      expect(prompt).toMatch(/too slow|too few relevant/i);
      expect(prompt).toMatch(/explicitly requested/i);
    });

    it("suppresses the Miyo steering when the builtin prompt is disabled, even if the skill is enabled", () => {
      updateSetting("enableMiyoSearchSkill", true);
      setDisableBuiltinSystemPrompt(true);
      const prompt = buildAgentSystemPrompt();
      expect(prompt).not.toContain(COPILOT_MIYO_SEARCH_STEERING);
    });

    it("never copies user-authored project instructions or context payloads", () => {
      const prompt = buildAgentSystemPrompt();
      expect(prompt).not.toContain("<project_instructions>");
      expect(prompt).not.toMatch(/<project_context>[\s\S]*<\/project_context>/);
    });

    it("tells the agent that a project AGENTS.md outranks the vault one", () => {
      expect(buildAgentSystemPrompt()).toContain(COPILOT_INSTRUCTION_PRECEDENCE);
    });

    it("keeps the precedence rule through the builtin toggle, like the workspace policy", () => {
      setDisableBuiltinSystemPrompt(true);
      expect(buildAgentSystemPrompt()).toContain(COPILOT_INSTRUCTION_PRECEDENCE);
    });

    // The cache contract: this string is a provider cache prefix, so anything that is not
    // product source or a product capability toggle must leave it byte-identical. `toBe`,
    // not `toContain` — a containment assertion still passes while extra bytes shift
    // everything after it out of the cached prefix.
    it("emits identical bytes no matter which Chat prompt is selected", () => {
      const baseline = buildAgentSystemPrompt();

      updateCachedSystemPrompts([makePrompt("Haiku", "respond in haiku")]);
      setSelectedPromptTitle("Haiku");
      updateSetting("defaultSystemPromptTitle", "Haiku");

      expect(buildAgentSystemPrompt()).toBe(baseline);
    });

    it("emits identical bytes across vaults, projects, models and sessions", () => {
      const baseline = buildAgentSystemPrompt();

      // Everything a session carries that is not product configuration. None of these is an
      // argument to the builder today; this asserts none of them becomes one.
      updateSetting("defaultModelKey", "some-other-model|anthropic");
      updateSetting("projectsFolder", "vault-b/projects");
      updateSetting("defaultSaveFolder", "vault-b/chats");

      expect(buildAgentSystemPrompt()).toBe(baseline);
    });

    it("carries no vault path, date, model id or session id", () => {
      const prompt = buildAgentSystemPrompt();

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
