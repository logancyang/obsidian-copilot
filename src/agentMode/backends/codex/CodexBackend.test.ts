import { resetSettings, setSettings } from "@/settings/model";
import {
  setDefaultSystemPromptTitle,
  setDisableBuiltinSystemPrompt,
  setSelectedPromptTitle,
  updateCachedSystemPrompts,
} from "@/system-prompts/state";
import type { UserSystemPrompt } from "@/system-prompts/type";
import { SYMPOSIUM_WORKSPACE_ROOT_ENV } from "@/symposium/constants";
import { buildAgentSystemPrompt } from "@/agentMode/backends/shared/agentSystemPrompt";
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

  it("forwards the Copilot prompt through both current and legacy adapter config paths", async () => {
    const backend = new CodexBackend();
    const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
    expect(desc.command).toBe("/usr/local/bin/codex-acp");
    expect(desc.env[SYMPOSIUM_WORKSPACE_ROOT_ENV]).toBe("/vault");

    const config = JSON.parse(desc.env.CODEX_CONFIG as string);
    expect(config.developer_instructions).toContain("Obsidian Copilot");
    expect(config.developer_instructions).toContain(
      "NOT a software-engineering agent or CLI coding tool"
    );
    expect(config.developer_instructions).toContain("{folder_name}");
    expect(config.developer_instructions).toContain("{activeNote}");
    expect(config.developer_instructions).not.toContain("metadata.copilot-enabled-agents");
    expect(config.developer_instructions).not.toContain("copilot/skills/<name>/SKILL.md");

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

  it("passes the plugin version to built-in Copilot Plus skills", async () => {
    setSettings({ isPaidUser: true, plusLicenseKey: "plus-token", userId: "user-1" });

    const desc = await new CodexBackend("4.0.0-preview-260802").buildSpawnDescriptor({
      vaultBasePath: "/vault",
    });

    expect(desc.env.COPILOT_CLIENT_VERSION).toBe("4.0.0-preview-260802");
  });

  it("encodes the shared product prompt into both paths, byte for byte", async () => {
    const desc = await new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "/vault" });
    const shared = buildAgentSystemPrompt();

    // `toBe`, not `toContain`: this string is the provider cache prefix, and a containment
    // check passes while stray bytes push everything after it out of the cache.
    expect(JSON.parse(desc.env.CODEX_CONFIG as string).developer_instructions).toBe(shared);
    const cIdx = desc.args.indexOf("-c");
    expect(desc.args[cIdx + 1]).toBe(`developer_instructions=${toTomlBasicString(shared)}`);
  });

  it("keeps those bytes identical when the vault path changes", async () => {
    const backend = new CodexBackend();
    const a = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
    const b = await backend.buildSpawnDescriptor({ vaultBasePath: "/somewhere/else/vault" });

    expect(JSON.parse(b.env.CODEX_CONFIG as string).developer_instructions).toBe(
      JSON.parse(a.env.CODEX_CONFIG as string).developer_instructions
    );
    expect(b.args[b.args.indexOf("-c") + 1]).toBe(a.args[a.args.indexOf("-c") + 1]);
  });

  it("does not copy Chat mode custom prompts into developer_instructions", async () => {
    updateCachedSystemPrompts([makeSystemPrompt("Haiku", "respond in haiku")]);
    setSelectedPromptTitle("Haiku");
    const backend = new CodexBackend();
    const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
    const value = desc.args[desc.args.indexOf("-c") + 1];
    expect(value).toContain("Obsidian Copilot");
    expect(value).not.toContain("<user_custom_instructions>");
    expect(value).not.toContain("respond in haiku");
  });

  it("suppresses the base prompt when 'disable builtin' is on, keeping the pill directive", async () => {
    updateCachedSystemPrompts([makeSystemPrompt("Haiku", "respond in haiku")]);
    setSelectedPromptTitle("Haiku");
    setDisableBuiltinSystemPrompt(true);
    const backend = new CodexBackend();
    const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
    const value = desc.args[desc.args.indexOf("-c") + 1];
    expect(value).not.toContain("Obsidian Copilot");
    expect(value).not.toContain("respond in haiku");
    // Pill directive is functional wiring, not builtin framing — always sent.
    expect(value).toContain("{folder_name}");
  });

  it("does not template a skills folder into developer_instructions", async () => {
    setSettings({
      agentMode: {
        byok: {},
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

  it("pins spawn-time approval policy, reviewer, and sandbox to canonical Default mode", async () => {
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
    expect(JSON.parse(desc.env.CODEX_CONFIG as string)).toEqual(
      expect.objectContaining({
        approval_policy: "on-request",
        approvals_reviewer: "user",
        sandbox_mode: "workspace-write",
      })
    );
  });

  it("preserves user CODEX_CONFIG keys while enforcing Copilot-owned fields", async () => {
    setSettings({
      agentMode: {
        byok: {},
        activeBackend: "codex",
        debugFullFrames: false,
        welcomeDismissed: false,
        skills: { folder: "copilot/skills" },
        backends: {
          codex: {
            binaryPath: "/usr/local/bin/codex-acp",
            envOverrides: {
              CODEX_CONFIG: JSON.stringify({
                model: "custom-model",
                developer_instructions: "drop Copilot prompt",
                approval_policy: "never",
                approvals_reviewer: "auto_review",
                sandbox_mode: "danger-full-access",
              }),
            },
          },
        },
      },
    });

    const desc = await new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "/vault" });
    const config = JSON.parse(desc.env.CODEX_CONFIG as string);
    expect(config).toEqual(
      expect.objectContaining({
        model: "custom-model",
        approval_policy: "on-request",
        approvals_reviewer: "user",
        sandbox_mode: "workspace-write",
      })
    );
    expect(config.developer_instructions).toContain("Obsidian Copilot");
    expect(config.developer_instructions).not.toContain("drop Copilot prompt");
  });

  it.each(["not-json", "[]", "null"])(
    "rejects an invalid CODEX_CONFIG override without echoing it (%s)",
    async (CODEX_CONFIG) => {
      setSettings({
        agentMode: {
          byok: {},
          activeBackend: "codex",
          debugFullFrames: false,
          welcomeDismissed: false,
          skills: { folder: "copilot/skills" },
          backends: {
            codex: {
              binaryPath: "/usr/local/bin/codex-acp",
              envOverrides: { CODEX_CONFIG },
            },
          },
        },
      });

      await expect(
        new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "/vault" })
      ).rejects.toThrow("Codex CODEX_CONFIG must be a valid JSON object.");
    }
  );

  it("starts current codex-acp adapters in their canonical default mode", async () => {
    const backend = new CodexBackend();
    const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
    expect(desc.env.INITIAL_AGENT_MODE).toBe("agent");
  });

  it("lets a user override the initial codex-acp mode", async () => {
    setSettings({
      agentMode: {
        byok: {},
        activeBackend: "codex",
        debugFullFrames: false,
        welcomeDismissed: false,
        skills: { folder: "copilot/skills" },
        backends: {
          codex: {
            binaryPath: "/usr/local/bin/codex-acp",
            envOverrides: { INITIAL_AGENT_MODE: "read-only" },
          },
        },
      },
    });
    const backend = new CodexBackend();
    const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
    expect(desc.env.INITIAL_AGENT_MODE).toBe("read-only");
  });

  it("does not add a project.md fallback to the codex spawn args", async () => {
    // Omitting the fallback prevents a GLOBAL session from treating a vault-root project.md note
    // as codex instructions (the spawn descriptor has no scope to gate on).
    const backend = new CodexBackend();
    const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
    expect(desc.args).not.toContainEqual(expect.stringContaining("project_doc_fallback_filenames"));
  });

  it("throws when the codex binary path is unset", async () => {
    setSettings({
      agentMode: {
        byok: {},
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
