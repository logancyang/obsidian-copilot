import { DEFAULT_SETTINGS } from "@/constants";
import type { CopilotSettings } from "@/settings/model";
import { isObsidianCliEnabled } from "@/services/obsidianCli/ObsidianCliClient";
import {
  BUILTIN_SKILLS,
  builtinSkillUnavailableReason,
  DEFAULT_BUILTIN_PREFERENCES,
  isBuiltinSkillEnabledFor,
  PLUS_ENV,
  SELF_HOST_WEB_SEARCH_ENV,
  SELF_HOST_WEB_SEARCH_TOKEN_ENV,
  SELF_HOST_WEB_SEARCH_URL_ENV,
} from "./builtinSkills";

jest.mock("@/services/obsidianCli/ObsidianCliClient", () => ({
  isObsidianCliEnabled: jest.fn(() => true),
}));

const mockIsObsidianCliEnabled = jest.mocked(isObsidianCliEnabled);

function scriptOf(name: string, ext: ".sh" | ".cmd" | ".ps1" = ".sh"): string {
  const skill = BUILTIN_SKILLS.find((s) => s.name === name);
  if (!skill) throw new Error(`no builtin skill ${name}`);
  const file = skill.files.find((f) => f.path.endsWith(ext));
  if (!file) throw new Error(`skill ${name} ships no ${ext} script`);
  return file.content;
}

const RELAY_SKILLS = BUILTIN_SKILLS.filter((skill) => skill.name.startsWith("copilot-"));

const ISSUE_599 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/599";

function settingsWith(
  builtinPreferences: NonNullable<CopilotSettings["agentMode"]["skills"]["builtinPreferences"]>,
  overrides: Partial<CopilotSettings> = {}
): CopilotSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
    agentMode: {
      ...DEFAULT_SETTINGS.agentMode,
      skills: { ...DEFAULT_SETTINGS.agentMode.skills, builtinPreferences },
    },
  };
}

describe("builtinSkills", () => {
  describe("BUILTIN_SKILLS", () => {
    it("ships the approved Plus and Obsidian skills in a fixed order", () => {
      expect(BUILTIN_SKILLS.map((s) => s.name)).toEqual([
        "copilot-web-search",
        "copilot-web-fetch",
        "copilot-youtube-transcript",
        "copilot-fetch-x",
        "obsidian-markdown",
        "obsidian-bases",
        "json-canvas",
        "obsidian-cli",
      ]);
    });

    it("ships one runnable script per OS — POSIX sh + Windows cmd/ps1, no Node", () => {
      for (const skill of RELAY_SKILLS) {
        const sh = skill.files.find((f) => f.path.endsWith(".sh"));
        const cmd = skill.files.find((f) => f.path.endsWith(".cmd"));
        const ps1 = skill.files.find((f) => f.path.endsWith(".ps1"));
        expect(sh).toBeDefined();
        expect(cmd).toBeDefined();
        expect(ps1).toBeDefined();
        expect(cmd!.path).toBe(sh!.path.replace(/\.sh$/, ".cmd"));
        expect(ps1!.path).toBe(sh!.path.replace(/\.sh$/, ".ps1"));
        expect(skill.skillMd).toContain(`sh "/absolute/path/to/this/skill/directory/${sh!.path}"`);
        expect(skill.skillMd).toContain(`& "/absolute/path/to/this/skill/directory/${cmd!.path}"`);
        expect(skill.skillMd).not.toContain("install Node.js");
        expect(skill.skillMd).not.toContain("node ");
        expect(skill.files.some((f) => f.path.endsWith(".mjs"))).toBe(false);
        expect(cmd!.content).toContain("WindowsPowerShell\\v1.0\\powershell.exe");
        expect(cmd!.content).toContain("-ExecutionPolicy Bypass");
        expect(cmd!.content).toContain(`-File "%~dp0${ps1!.path}"`);
      }
    });

    it("reads its config from the injected env and never embeds a key (both scripts)", () => {
      for (const skill of RELAY_SKILLS) {
        const sh = scriptOf(skill.name, ".sh");
        expect(sh).toContain(`#!/bin/sh`);
        expect(sh).toContain(PLUS_ENV.licenseKey);
        expect(sh).toContain(PLUS_ENV.baseUrl);
        expect(sh).toContain("Authorization: Bearer $KEY");
        expect(sh).toContain("X-Client-Version: $CLIENT_VERSION");
        expect(sh).toContain("require_relay()");
        expect(sh).toContain("require_relay\n");
        expect(sh).toContain("Copilot Plus");

        const ps1 = scriptOf(skill.name, ".ps1");
        expect(ps1).toContain(`[Environment]::GetEnvironmentVariable('${PLUS_ENV.licenseKey}')`);
        expect(ps1).toContain(`[Environment]::GetEnvironmentVariable('${PLUS_ENV.baseUrl}')`);
        expect(ps1).toContain('Authorization = "Bearer $KEY"');
        expect(ps1).toContain("'X-Client-Version' = $CLIENT_VERSION");
        expect(ps1).toContain("function RequireRelay");
        expect(ps1).toContain("RequireRelay\n");
        expect(ps1).toContain("Copilot Plus");
        expect(ps1).toContain("[System.Text.Encoding]::UTF8.GetBytes($json)");
        expect(ps1).toContain("application/json; charset=utf-8");
        expect(ps1).toContain("-Body $bytes");
        expect(ps1).toContain("[Console]::OutputEncoding = [System.Text.Encoding]::UTF8");
        expect(ps1).toContain("$OutputEncoding = [System.Text.Encoding]::UTF8");
      }
    });

    it("falls back to the agent's own tools instead of blocking when Plus is absent", () => {
      for (const skill of RELAY_SKILLS) {
        const sh = scriptOf(skill.name, ".sh");
        expect(sh).toContain("your own equivalent built-in tools");
        expect(sh).not.toContain("web tools");
        expect(sh).toContain("never refuse");
        expect(sh).toContain("$(( $$ % 4 ))");
        expect(sh).toContain(
          "get a license key at https://www.obsidiancopilot.com/pricing?utm_source=obsidian_copilot&utm_medium=skill_no_license"
        );
        expect(sh).toContain('401|403) die "$LICENSE_INVALID"');
        expect(sh).toContain(
          "renew their Copilot Plus license at https://www.obsidiancopilot.com/pricing?utm_source=obsidian_copilot&utm_medium=skill_license_invalid"
        );
        expect(sh).not.toContain("require Copilot Plus");
        expect(sh).toContain("higher-quality web, YouTube, and X tools");

        expect(sh).toContain("$RELAY_FAILED_FALLBACK");
        expect(sh).toContain("your own equivalent built-in tool for this");

        const ps1 = scriptOf(skill.name, ".ps1");
        expect(ps1).toContain("your own equivalent built-in tools");
        expect(ps1).not.toContain("web tools");
        expect(ps1).toContain("($PID % 4) -eq 0");
        expect(ps1).toContain("Die $LICENSE_INVALID");
        expect(ps1).toContain("RELAY_FAILED_FALLBACK");
      }
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/165 routes Self-Host web search through the plugin-owned channel without the optional Obsidian CLI", () => {
      const sh = scriptOf("copilot-web-search", ".sh");
      expect(sh).toContain(SELF_HOST_WEB_SEARCH_ENV);
      expect(sh).toContain(SELF_HOST_WEB_SEARCH_URL_ENV);
      expect(sh).toContain(SELF_HOST_WEB_SEARCH_TOKEN_ENV);
      expect(sh).toContain("curl --noproxy '*' -sS -X POST \"$SELF_HOST_URL\"");
      expect(sh).toContain("--data-binary @-");
      expect(sh).toContain("-w '\\n%{http_code}'");
      expect(sh).toContain("printf '%s\\n' \"$RESPONSE_BODY\" >&2");
      expect(sh).not.toContain("COPILOT_OBSIDIAN_CLI");
      expect(sh).not.toContain("vault=$VAULT_NAME");
      expect(sh.indexOf('if [ "$SELF_HOST" = "1" ]')).toBeLessThan(sh.indexOf("require_relay\n"));

      const ps1 = scriptOf("copilot-web-search", ".ps1");
      expect(ps1).toContain("Invoke-WebRequest");
      expect(ps1).toContain("Bearer $SELF_HOST_TOKEN");
      expect(ps1).toContain("[Console]::Out.WriteLine((Read-Utf8Body $response))");
      expect(ps1).not.toContain("COPILOT_OBSIDIAN_CLI");
      expect(ps1.indexOf("if ($SELF_HOST -eq '1')")).toBeLessThan(ps1.indexOf("RequireRelay\n"));
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/165 fails Self-Host page fetch closed without invoking the hosted relay", () => {
      const skill = BUILTIN_SKILLS.find((item) => item.name === "copilot-web-fetch");
      expect(skill?.skillMd).toContain("never use an agent-native web");

      const sh = scriptOf("copilot-web-fetch", ".sh");
      expect(sh).toContain('if [ "$SELF_HOST" = "1" ]');
      expect(sh).toContain("Do not use a native web-fetch tool");
      expect(sh.indexOf("Do not use a native web-fetch tool")).toBeLessThan(
        sh.indexOf("require_relay\n")
      );

      const ps1 = scriptOf("copilot-web-fetch", ".ps1");
      expect(ps1).toContain("if ($SELF_HOST -eq '1')");
      expect(ps1).toContain("Do not use a native web-fetch tool");
      expect(ps1.indexOf("Do not use a native web-fetch tool")).toBeLessThan(
        ps1.indexOf("RequireRelay\n")
      );
    });

    it("maps each relay tool to its endpoint and request body (both scripts)", () => {
      expect(scriptOf("copilot-web-search", ".sh")).toContain('relay "/websearch"');
      expect(scriptOf("copilot-web-search", ".sh")).toContain('\\"query\\"');
      expect(scriptOf("copilot-web-fetch", ".sh")).toContain('relay "/url4llm"');
      expect(scriptOf("copilot-web-fetch", ".sh")).toContain('\\"url\\"');
      expect(scriptOf("copilot-youtube-transcript", ".sh")).toContain('relay "/youtube4llm"');
      expect(scriptOf("copilot-fetch-x", ".sh")).toContain('relay "/twitter4llm"');
      expect(scriptOf("copilot-web-search", ".sh")).toContain('$(json_escape "$ARG")');

      expect(scriptOf("copilot-web-search", ".ps1")).toContain('Invoke-Relay "/websearch"');
      expect(scriptOf("copilot-web-search", ".ps1")).toContain(
        "@{ query = $ARG; user_id = $USER_ID }"
      );
      expect(scriptOf("copilot-web-fetch", ".ps1")).toContain('Invoke-Relay "/url4llm"');
      expect(scriptOf("copilot-web-fetch", ".ps1")).toContain(
        "@{ url = $ARG; user_id = $USER_ID }"
      );
      expect(scriptOf("copilot-youtube-transcript", ".ps1")).toContain(
        'Invoke-Relay "/youtube4llm"'
      );
      expect(scriptOf("copilot-fetch-x", ".ps1")).toContain('Invoke-Relay "/twitter4llm"');
    });

    it("keeps every SKILL.md frontmatter version in sync with the numeric version", () => {
      for (const skill of BUILTIN_SKILLS) {
        expect(skill.skillMd).toContain(`copilot-builtin-version: "${skill.version}"`);
      }
    });

    it(`tells every script-backed skill to run through the agent's shell tool, never as code-execution code (${ISSUE_599})`, () => {
      const scripted = BUILTIN_SKILLS.filter((skill) =>
        skill.files.some((file) => file.path.endsWith(".sh"))
      );
      expect(scripted.map((skill) => skill.name)).toEqual([
        "copilot-web-search",
        "copilot-web-fetch",
        "copilot-youtube-transcript",
        "copilot-fetch-x",
      ]);
      for (const skill of scripted) {
        expect(skill.skillMd).toContain(
          "`Bash` in Claude Code, `shell` in OpenCode, `exec_command` in Codex"
        );
        expect(skill.skillMd).toContain("never pass it as the code of a\ncode-execution tool");
      }
    });
  });

  describe("DEFAULT_BUILTIN_PREFERENCES", () => {
    it("stores web search and web fetch as opt-outs so older releases keep them https://github.com/Brevilabs/obsidian-copilot-private/issues/629", () => {
      expect(DEFAULT_BUILTIN_PREFERENCES).toMatchObject({
        "copilot-web-search": { disabled: true },
        "copilot-web-fetch": { disabled: true },
      });
      expect(DEFAULT_SETTINGS.agentMode.skills.builtinPreferences).toBe(
        DEFAULT_BUILTIN_PREFERENCES
      );
    });

    it("stores each skill's default-off agents as opt-outs (https://github.com/Brevilabs/obsidian-copilot-private/issues/726)", () => {
      expect(DEFAULT_BUILTIN_PREFERENCES).toEqual({
        "copilot-web-search": { disabled: true },
        "copilot-web-fetch": { disabled: true },
        "obsidian-markdown": { disabledAgents: ["claude", "codex"] },
        "obsidian-bases": { disabledAgents: ["claude"] },
        "json-canvas": { disabledAgents: ["claude", "codex"] },
        "obsidian-cli": { disabledAgents: ["claude", "codex"] },
      });
    });
  });

  describe("builtinSkillUnavailableReason()", () => {
    it("leaves every skill available while Obsidian's command line interface is on", () => {
      mockIsObsidianCliEnabled.mockReturnValue(true);
      for (const skill of BUILTIN_SKILLS) {
        expect(builtinSkillUnavailableReason(skill.name)).toBeUndefined();
      }
    });

    it("makes only obsidian-cli unavailable, naming the Obsidian setting, while the command line interface is off (https://github.com/Brevilabs/obsidian-copilot-private/issues/726)", () => {
      mockIsObsidianCliEnabled.mockReturnValue(false);
      expect(builtinSkillUnavailableReason("obsidian-cli")).toBe(
        "Turn on Command line interface in Obsidian's Settings → General to use this skill."
      );
      for (const skill of BUILTIN_SKILLS.filter((skill) => skill.name !== "obsidian-cli")) {
        expect(builtinSkillUnavailableReason(skill.name)).toBeUndefined();
      }
      mockIsObsidianCliEnabled.mockReturnValue(true);
    });
  });

  describe("isBuiltinSkillEnabledFor()", () => {
    it("enables every seeded builtin for every agent when no preference is stored", () => {
      const settings = settingsWith({});
      for (const agent of ["claude", "codex", "opencode"]) {
        expect(isBuiltinSkillEnabledFor(settings, "copilot-web-search", agent)).toBe(true);
      }
    });

    it("keeps default-off skills off for every agent in a fresh install https://github.com/Brevilabs/obsidian-copilot-private/issues/629", () => {
      for (const agent of ["claude", "codex", "opencode"]) {
        for (const name of ["copilot-web-search", "copilot-web-fetch"]) {
          expect(isBuiltinSkillEnabledFor(DEFAULT_SETTINGS, name, agent)).toBe(false);
        }
        expect(isBuiltinSkillEnabledFor(DEFAULT_SETTINGS, "copilot-fetch-x", agent)).toBe(true);
      }
    });

    it("disables a skill only for the agents the user opted out", () => {
      const settings = settingsWith({ "copilot-web-search": { disabledAgents: ["opencode"] } });
      expect(isBuiltinSkillEnabledFor(settings, "copilot-web-search", "opencode")).toBe(false);
      expect(isBuiltinSkillEnabledFor(settings, "copilot-web-search", "claude")).toBe(true);
    });

    it("disables a skill for every agent when the user turned it off entirely", () => {
      const settings = settingsWith({ "copilot-fetch-x": { disabled: true } });
      for (const agent of ["claude", "codex", "opencode"]) {
        expect(isBuiltinSkillEnabledFor(settings, "copilot-fetch-x", agent)).toBe(false);
      }
    });

    it("reports a name that is not a managed builtin as disabled", () => {
      expect(isBuiltinSkillEnabledFor(settingsWith({}), "user-authored", "claude")).toBe(false);
    });
  });
});
