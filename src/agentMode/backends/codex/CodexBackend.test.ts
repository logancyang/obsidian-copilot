import { resetSettings, setSettings } from "@/settings/model";
import { CodexBackend, toTomlBasicString } from "./CodexBackend";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

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
    setSettings({
      agentMode: {
        enabled: true,
        byok: {},
        mcpServers: [],
        activeBackend: "codex",
        debugFullFrames: false,
        skills: { folder: "copilot/skills" },
        backends: {
          codex: { binaryPath: "/usr/local/bin/codex-acp" },
        },
      },
    });
  });

  it("injects the skill-creation directive via -c developer_instructions", async () => {
    const backend = new CodexBackend();
    const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
    expect(desc.command).toBe("/usr/local/bin/codex-acp");
    const cIdx = desc.args.indexOf("-c");
    expect(cIdx).toBeGreaterThanOrEqual(0);
    const value = desc.args[cIdx + 1];
    expect(value.startsWith("developer_instructions=")).toBe(true);
    // The TOML value carries the directive text (newlines escaped as \n).
    expect(value).toContain('metadata.copilot-enabled-agents: \\"codex\\"');
    expect(value).toContain("copilot/skills/<name>/SKILL.md");
    expect(value).toContain(".claude/skills/");
    expect(value).toContain(".agents/skills/");
    expect(value).toContain(".opencode/skills/");
  });

  it("templates a custom skills folder at spawn time", async () => {
    setSettings({
      agentMode: {
        enabled: true,
        byok: {},
        mcpServers: [],
        activeBackend: "codex",
        debugFullFrames: false,
        skills: { folder: "team-skills" },
        backends: { codex: { binaryPath: "/usr/local/bin/codex-acp" } },
      },
    });
    const backend = new CodexBackend();
    const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
    const cIdx = desc.args.indexOf("-c");
    const value = desc.args[cIdx + 1];
    expect(value).toContain("team-skills/<name>/SKILL.md");
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

  it("throws when the codex binary path is unset", async () => {
    setSettings({
      agentMode: {
        enabled: true,
        byok: {},
        mcpServers: [],
        activeBackend: "codex",
        debugFullFrames: false,
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
