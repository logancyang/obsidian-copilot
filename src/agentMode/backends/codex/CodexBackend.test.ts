import { resetSettings, setSettings } from "@/settings/model";
import {
  setDefaultSystemPromptTitle,
  setDisableBuiltinSystemPrompt,
  setSelectedPromptTitle,
  updateCachedSystemPrompts,
} from "@/system-prompts/state";
import type { UserSystemPrompt } from "@/system-prompts/type";
import { CodexBackend, toTomlBasicString } from "./CodexBackend";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

function makeSystemPrompt(title: string, content: string): UserSystemPrompt {
  return { title, content, createdMs: 0, modifiedMs: 0, lastUsedMs: 0 };
}

/** The system-prompt jotai store is module-global — reset it between tests. */
function resetPromptState(): void {
  setDisableBuiltinSystemPrompt(false);
  setSelectedPromptTitle("");
  setDefaultSystemPromptTitle("");
  updateCachedSystemPrompts([]);
}

jest.mock("@/agentMode/skills", () => {
  const actual = jest.requireActual("@/agentMode/skills");
  return {
    ...actual,
    SkillManager: {
      hasInstance: () => true,
      getInstance: () => ({
        getAgentDirsProjectRel: () => ({
          claude: ".claude/skills",
          codex: ".agents/skills",
          opencode: ".opencode/skills",
        }),
      }),
    },
  };
});

describe("CodexBackend.buildSpawnDescriptor", () => {
  beforeEach(() => {
    resetSettings();
    resetPromptState();
    setSettings({
      agentMode: {
        byok: {},
        mcpServers: [],
        activeBackend: "codex",
        debugFullFrames: false,
        welcomeDismissed: false,
        skills: { folder: "copilot/skills" },
        backends: {
          codex: { binaryPath: "/usr/local/bin/codex-acp" },
        },
      },
    });
  });

  it("forwards the Copilot base prompt + pill-syntax directive via -c developer_instructions", async () => {
    const backend = new CodexBackend();
    const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
    expect(desc.command).toBe("/usr/local/bin/codex-acp");
    const cIdx = desc.args.indexOf("-c");
    expect(cIdx).toBeGreaterThanOrEqual(0);
    const value = desc.args[cIdx + 1];
    expect(value.startsWith("developer_instructions=")).toBe(true);
    // Base Obsidian-vault framing reaches Codex (decode the TOML basic string).
    expect(value).toContain("Obsidian Copilot");
    expect(value).toContain("NOT a software-engineering agent or CLI coding tool");
    // Pill-syntax directive.
    expect(value).toContain("{folder_name}");
    expect(value).toContain("{activeNote}");
    // Skill discovery is automatic from `.agents/skills/`, so the directive
    // never templates in SKILL.md authoring instructions.
    expect(value).not.toContain("metadata.copilot-enabled-agents");
    expect(value).not.toContain("copilot/skills/<name>/SKILL.md");
  });

  it("appends the user's selected custom prompt to developer_instructions", async () => {
    updateCachedSystemPrompts([makeSystemPrompt("Haiku", "respond in haiku")]);
    setSelectedPromptTitle("Haiku");
    const backend = new CodexBackend();
    const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
    const value = desc.args[desc.args.indexOf("-c") + 1];
    expect(value).toContain("Obsidian Copilot");
    // The TOML basic string escapes newlines as \n, so match the wrapper +
    // content rather than the literal multi-line block.
    expect(value).toContain("<user_custom_instructions>");
    expect(value).toContain("respond in haiku");
  });

  it("suppresses the base prompt when 'disable builtin' is on, keeping the user prompt + pill directive", async () => {
    updateCachedSystemPrompts([makeSystemPrompt("Haiku", "respond in haiku")]);
    setSelectedPromptTitle("Haiku");
    setDisableBuiltinSystemPrompt(true);
    const backend = new CodexBackend();
    const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
    const value = desc.args[desc.args.indexOf("-c") + 1];
    expect(value).not.toContain("Obsidian Copilot");
    expect(value).toContain("respond in haiku");
    // Pill directive is functional wiring, not builtin framing — always sent.
    expect(value).toContain("{folder_name}");
  });

  it("does not template a skills folder into developer_instructions", async () => {
    setSettings({
      agentMode: {
        byok: {},
        mcpServers: [],
        activeBackend: "codex",
        debugFullFrames: false,
        welcomeDismissed: false,
        skills: { folder: "team-skills" },
        backends: { codex: { binaryPath: "/usr/local/bin/codex-acp" } },
      },
    });
    const backend = new CodexBackend();
    const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
    const cIdx = desc.args.indexOf("-c");
    const value = desc.args[cIdx + 1];
    // The pill directive doesn't reference the skills folder at all.
    expect(value).not.toContain("team-skills");
    expect(value).not.toContain("copilot/skills");
  });

  it("escapes embedded double quotes and backslashes for TOML safety", async () => {
    // Folders can't contain quotes in practice (validateSkillsFolder
    // strips them), but the escape logic should still be airtight — the
    // resulting -c value is consumed by a TOML parser, so an unescaped
    // quote would terminate the basic-string literal and break
    // codex-acp's startup.
    const backend = new CodexBackend();
    const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
    const cIdx = desc.args.indexOf("-c");
    const value = desc.args[cIdx + 1];
    // The value is wrapped in unescaped outer quotes; any inner double
    // quote must be `\"` and every newline `\n` (no raw newlines, which
    // would also break TOML basic strings).
    expect(value).not.toMatch(/\n/);
    // Confirm the outer literal is well-formed: starts with `key="…` and
    // ends with `…"` (the closing quote of the TOML string).
    expect(value.startsWith('developer_instructions="')).toBe(true);
    expect(value.endsWith('"')).toBe(true);
  });

  it("escapes the full TOML basic-string control set", () => {
    // Named escapes per the TOML 1.0 spec.
    expect(toTomlBasicString("a\bb\tc\nd\fe\rf")).toBe('"a\\bb\\tc\\nd\\fe\\rf"');
    // Backslash + double-quote.
    expect(toTomlBasicString('back\\slash"quote')).toBe('"back\\\\slash\\"quote"');
    // Other controls fall through as \\uXXXX. Build the input from char
    // codes so the source file stays plain ASCII (and copies/pastes cleanly).
    const controls =
      String.fromCharCode(0x01) + String.fromCharCode(0x1f) + String.fromCharCode(0x7f);
    expect(toTomlBasicString(controls)).toBe('"\\u0001\\u001f\\u007f"');
    // Non-ASCII passes through unescaped.
    expect(toTomlBasicString("über — café")).toBe('"über — café"');
  });

  it("pins spawn-time approval_policy + sandbox_mode to canonical 'auto' preset", async () => {
    // Without these overrides codex-acp derives the initial mode from
    // ~/.codex/config.toml, which can land on read-only and surface as
    // "Plan" in our picker for a brief moment before the post-spawn
    // coerce kicks in. The TOML strings need outer quotes — codex parses
    // the value portion of `-c key=value` as TOML.
    const backend = new CodexBackend();
    const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
    expect(desc.args).toEqual(
      expect.arrayContaining([
        "-c",
        'approval_policy="on-request"',
        "-c",
        'sandbox_mode="workspace-write"',
      ])
    );
  });

  it("does not add a project.md fallback to the codex spawn args", async () => {
    // Session-start ensureAgentsMirror supersedes the spawn-level fallback for project scopes;
    // omitting it also prevents a GLOBAL session from treating a vault-root project.md note as
    // codex instructions (the spawn descriptor has no scope to gate on).
    const backend = new CodexBackend();
    const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
    expect(desc.args).not.toContainEqual(expect.stringContaining("project_doc_fallback_filenames"));
  });

  it("throws when the codex binary path is unset", async () => {
    setSettings({
      agentMode: {
        byok: {},
        mcpServers: [],
        activeBackend: "codex",
        debugFullFrames: false,
        welcomeDismissed: false,
        skills: { folder: "copilot/skills" },
        backends: {},
      },
    });
    const backend = new CodexBackend();
    await expect(backend.buildSpawnDescriptor({ vaultBasePath: "/vault" })).rejects.toThrow(
      /Codex binary path not configured/
    );
  });
});
