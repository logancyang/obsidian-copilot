import { DEFAULT_SETTINGS } from "@/constants";
import type { CopilotSettings } from "@/settings/model";
import {
  ALL_MANAGED_SKILLS,
  BUILTIN_SKILLS,
  DEFAULT_BUILTIN_PREFERENCES,
  isBuiltinSkillEnabledFor,
  isMiyoSearchSkillActive,
  MIYO_PARSE_SKILL,
  MIYO_SEARCH_SKILL,
  planManagedBuiltins,
  PLUS_ENV,
  SELF_HOST_WEB_SEARCH_ENV,
  SELF_HOST_WEB_SEARCH_TOKEN_ENV,
  SELF_HOST_WEB_SEARCH_URL_ENV,
} from "./builtinSkills";
import {
  OPENARTIFACTS_AGENT_HANDOFF_DIR,
  OPENARTIFACTS_API_ORIGIN,
  OPENARTIFACTS_MAX_HTML_BYTES,
  OPENARTIFACTS_WORKSPACE_ROOT_ENV,
} from "@/openArtifacts/constants";

function scriptOf(name: string, ext: ".sh" | ".cmd" | ".ps1" = ".sh"): string {
  const skill = BUILTIN_SKILLS.find((s) => s.name === name);
  if (!skill) throw new Error(`no builtin skill ${name}`);
  const file = skill.files.find((f) => f.path.endsWith(ext));
  if (!file) throw new Error(`skill ${name} ships no ${ext} script`);
  return file.content;
}

const RELAY_SKILLS = BUILTIN_SKILLS.filter((skill) => skill.name.startsWith("copilot-"));

const ISSUE_599 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/599";
const ISSUE_717 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/717";

function flattened(markdown: string): string {
  return markdown.replace(/\s+/g, " ");
}

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
    it("ships the approved Plus and Obsidian skills to all three agents", () => {
      expect(BUILTIN_SKILLS.map((s) => s.name)).toEqual([
        "copilot-web-search",
        "copilot-web-fetch",
        "copilot-youtube-transcript",
        "copilot-fetch-x",
        "openartifacts-publish",
        "obsidian-markdown",
        "obsidian-bases",
        "json-canvas",
        "obsidian-cli",
      ]);
      for (const skill of BUILTIN_SKILLS) {
        expect(skill.enabledAgents).toEqual(["claude", "codex", "opencode"]);
      }
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

    it("records the page in the Markdown note as its own step, before the report", () => {
      const md = BUILTIN_SKILLS.find((item) => item.name === "openartifacts-publish")!.skillMd;
      const record = md.indexOf("### Record the page in the note");
      const report = md.indexOf("### Report");
      expect(record).toBeGreaterThan(md.indexOf("## 3. Publish"));
      expect(report).toBeGreaterThan(record);
      expect(md.slice(record, report)).toContain(
        "`openartifacts` frontmatter property to the receipt's `url`"
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/394 publishes over HTTPS with the injected license key and never touches the Obsidian CLI", () => {
      const skill = BUILTIN_SKILLS.find((item) => item.name === "openartifacts-publish");
      expect(skill).toBeDefined();
      expect(skill!.version).toBe(9);

      expect(skill!.files.map((file) => file.path)).toEqual([
        "themes/research-memo.md",
        "openartifacts-publish.sh",
        "openartifacts-publish.cmd",
        "openartifacts-publish.ps1",
      ]);

      const md = skill!.skillMd;
      expect(md).toContain(PLUS_ENV.licenseKey);
      expect(md).toContain(
        `$${OPENARTIFACTS_WORKSPACE_ROOT_ENV}/${OPENARTIFACTS_AGENT_HANDOFF_DIR}/`
      );
      expect(md).toContain(`\`${OPENARTIFACTS_MAX_HTML_BYTES}\` bytes`);
      expect(md).toContain("clickable Markdown link to the exact HTML file");
      expect(md).toContain("`[page name.html](/.openartifacts/handoffs/page%20name.html)`");
      expect(md).toContain("Then end your turn");
      expect(md).toContain("Never publish in the same turn that generated the HTML");
      expect(md).toContain("Never simulate the user's approval");
      expect(md).toContain("`openartifacts` frontmatter property");
      expect(md).toContain("Themes are optional");
      expect(md).toMatch(/a missing theme must never block publishing/);
      expect(md).toContain("Report that message verbatim");
      expect(md).toContain("unshare <docId>");
      expect(md).toContain(
        'sh "/absolute/path/to/this/skill/directory/openartifacts-publish.sh" publish'
      );
      expect(md).toContain(
        '& "/absolute/path/to/this/skill/directory/openartifacts-publish.cmd" publish'
      );
      for (const gone of [
        "require_escalated",
        "openArtifactsAgentBridge",
        "shared-publishing-rules",
        "sandbox",
        "modal",
        "protected",
      ]) {
        expect(md).not.toContain(gone);
      }

      for (const script of [
        scriptOf("openartifacts-publish", ".sh"),
        scriptOf("openartifacts-publish", ".ps1"),
      ]) {
        expect(script).toContain(PLUS_ENV.licenseKey);
        expect(script).toContain(OPENARTIFACTS_API_ORIGIN);
        expect(script).toContain("OPENARTIFACTS_API_HOST");
        expect(script).toContain("/api/v1/docs");
        expect(script).toContain("Bearer");
        expect(script).toContain("^[0-9abcdefghjkmnpqrstvwxyz]{16}$");
        expect(script).not.toContain("COPILOT_OBSIDIAN_CLI");
        expect(script).not.toContain("eval");
        expect(script).not.toContain("OPENARTIFACTS_TOKEN");
        expect(script).not.toContain("node ");
      }
      expect(scriptOf("openartifacts-publish", ".cmd")).toContain(
        '-File "%~dp0openartifacts-publish.ps1"'
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/707 asks who can open a new page, shares through the wrapper, and never sends linkAccess on create", () => {
      const skill = BUILTIN_SKILLS.find((item) => item.name === "openartifacts-publish");
      expect(skill).toBeDefined();
      expect(skill!.version).toBe(9);

      const md = skill!.skillMd;
      expect(md).toContain(
        "Who should be able to open it? Reply **publish** for anyone with the link, or name people, for example **publish for alice@acme.com**, to share it only with them."
      );
      expect(md).toContain("share <docId> add");
      expect(md).toContain("share <docId> decline");
      expect(md).toContain("share <docId> link invited");
      expect(md).toContain("People who opened it while it was public may have kept a copy.");
      expect(md).toContain("Published privately: {url}. Only you and {addresses} can open it.");
      expect(md).toContain("Manage who can open it: {manageUrl}");
      expect(md).toContain("Nothing was published.");
      expect(md).toContain('Report an update as "Updated: {url}."');
      expect(md).not.toContain("Report a public publish as");
      expect(md).toContain("After `link invited` makes a public page private");
      expect(md).not.toContain("removes the new page");
      expect(md).not.toContain("Share dialog");

      for (const path of ["openartifacts-publish.sh", "openartifacts-publish.ps1"]) {
        const script = skill!.files.find((file) => file.path === path)!.content;
        expect(script).toContain("/api/v1/private-docs");
        expect(script).toContain("Nothing was published.");
        expect(script).toContain("Not found, or this server does not support private documents.");
        expect(script).not.toContain('linkAccess":"invited');
        expect(script).not.toContain("linkAccess = 'invited'");
      }
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3196 formats filename-derived page titles in title case without duplicating an equivalent opening H1", () => {
      const skill = BUILTIN_SKILLS.find((item) => item.name === "openartifacts-publish");
      expect(skill).toBeDefined();

      const md = skill!.skillMd;
      expect(md).toContain("Use the note's file name without `.md` as its page title");
      expect(md).toMatch(/Convert the filename-derived title to\s+title case/);
      expect(md).toMatch(/both the HTML\s+`<title>` and a visible `<h1>`/);
      expect(md).toContain("above the rendered note body");
      expect(md).toMatch(/already starts with an\s+equivalent `<h1>`/);
      expect(md).toContain("do not add another heading");
      expect(md).toMatch(/Preserve all remaining note\s+content/);
      expect(md).toMatch(/do not edit the\s+source Markdown to add the heading/);
      expect(md).toContain("same complete HTML file");
      expect(md).toMatch(/wrap\s+naturally on narrow screens/);
      expect(md).toContain("Never truncate the title");
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3196 honors an explicit no-title request by omitting the added H1", () => {
      const skill = BUILTIN_SKILLS.find((item) => item.name === "openartifacts-publish");
      expect(skill).toBeDefined();

      const md = skill!.skillMd;
      expect(md).toMatch(/If the user explicitly asks for no\s+title/);
      expect(md).toContain("do not add the `<h1>`");
      expect(md).toContain("Keep the HTML `<title>` as browser metadata");
      expect(md).toMatch(/preserve any\s+authored opening heading as note content/);
    });

    it("publishes an existing HTML file unchanged through the same wrapper https://github.com/logancyang/obsidian-copilot/issues/3294", () => {
      const skill = BUILTIN_SKILLS.find((item) => item.name === "openartifacts-publish");
      expect(skill).toBeDefined();

      const md = skill!.skillMd;
      expect(md).toContain("existing Markdown note or local HTML file");
      expect(md).toContain("### Existing HTML file");
      expect(md).toMatch(/Pass that original HTML file path directly to\s+the wrapper/);
      expect(md).toContain("do not convert it to Markdown");
      expect(md).toMatch(/do\s+not render, rewrite, or copy it/);
      expect(md).toContain("never delete the original HTML file");
      expect(md).toMatch(
        /every reference to a local file[\s\S]*`srcset`[\s\S]*`poster`[\s\S]*CSS `url\(\.\.\.\)`[\s\S]*name each reference in the review message[\s\S]*will\s+not load on the published page because only the HTML file is uploaded[\s\S]*warning\s+does\s+not block publication[\s\S]*make the file self-contained or approve publishing\s+anyway[\s\S]*wait for the user to update the file[\s\S]*repeat steps 1 and 2 before accepting\s+publication approval/
      );
      expect(md).toContain(
        'sh "/absolute/path/to/this/skill/directory/openartifacts-publish.sh" publish "/absolute/path/to/page.html" "Page title"'
      );
      expect(md).toMatch(/For an existing HTML file on Windows, replace the handoff path/);
      expect(md).toContain("Success returns the same server receipt");
      expect(md).toMatch(
        /take the `docId` from an OpenArtifacts link the\s+user supplies or the receipt URL reported earlier/
      );
      expect(md).toMatch(
        /remove each `openartifacts` or `symposium` property\s+only when that property's own link has the same document id/
      );
    });
  });

  describe("MIYO_SEARCH_SKILL", () => {
    it("is a separate, Miyo-gated skill — not one of the always-seeded Plus skills", () => {
      expect(BUILTIN_SKILLS.map((s) => s.name)).not.toContain("miyo-search");
      expect(MIYO_SEARCH_SKILL.name).toBe("miyo-search");
      expect(MIYO_SEARCH_SKILL.enabledAgents).toEqual(["claude", "codex", "opencode"]);
    });

    const miyoScript = (ext: ".sh" | ".cmd"): string => {
      const file = MIYO_SEARCH_SKILL.files.find((f) => f.path.endsWith(ext));
      if (!file) throw new Error(`miyo-search ships no ${ext} script`);
      return file.content;
    };

    it("ships exactly two OS wrappers — POSIX sh + Windows cmd, no Node", () => {
      expect(MIYO_SEARCH_SKILL.files.map((f) => f.path)).toEqual([
        "miyo-search.sh",
        "miyo-search.cmd",
      ]);
      expect(MIYO_SEARCH_SKILL.skillMd).toContain(
        `sh "/absolute/path/to/this/skill/directory/miyo-search.sh"`
      );
      expect(MIYO_SEARCH_SKILL.skillMd).toContain(
        `& "/absolute/path/to/this/skill/directory/miyo-search.cmd"`
      );
      expect(MIYO_SEARCH_SKILL.files.some((f) => f.path.endsWith(".mjs"))).toBe(false);
      expect(MIYO_SEARCH_SKILL.skillMd).not.toContain("node ");
    });

    it("embeds no Plus license env — Miyo is a local loopback CLI", () => {
      expect(MIYO_SEARCH_SKILL.skillMd).not.toContain(PLUS_ENV.licenseKey);
      expect(MIYO_SEARCH_SKILL.skillMd).not.toContain(PLUS_ENV.baseUrl);
      expect(miyoScript(".sh")).not.toContain(PLUS_ENV.licenseKey);
      expect(miyoScript(".cmd")).not.toContain(PLUS_ENV.licenseKey);
    });

    it(`tells the agent to use it for every request the notes might answer, alongside grep for exact terms (${ISSUE_717})`, () => {
      const md = flattened(MIYO_SEARCH_SKILL.skillMd);
      expect(md).toMatch(
        /description:[^\n]*Use it for every request that might be answered from the user's notes, alongside grep for exact terms\./
      );
      expect(md).toContain(
        "When to use it: for every request that might be answered from the user's notes, alongside `grep`/glob for any exact names, terms, tags or quoted phrases in the request."
      );
    });

    it(`no longer limits it to when grep falls short or to a single search step (${ISSUE_717})`, () => {
      const md = flattened(MIYO_SEARCH_SKILL.skillMd);
      expect(md).not.toMatch(/too slow|doesn't surface enough relevant notes/i);
      expect(md).not.toMatch(/single search step|do not fall back to other search tools/i);
    });

    it(`has the agent combine Miyo and keyword results by note path and continue with keyword search when Miyo is unavailable (${ISSUE_717})`, () => {
      const md = flattened(MIYO_SEARCH_SKILL.skillMd);
      expect(md).toContain(
        "Combine its results with your keyword search results by note path. If Miyo reports that it is unavailable, continue with keyword search."
      );
    });

    it("runs one deterministic `miyo search ... --json` in each script", () => {
      expect(miyoScript(".sh")).toContain('search "$QUERY"');
      expect(miyoScript(".sh")).toContain("--json");
      expect(miyoScript(".cmd")).toContain("search %* -n 10 --json");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 passes the exact active-vault identity in Current vault mode on POSIX and Windows", () => {
      const sh = miyoScript(".sh");
      const cmd = miyoScript(".cmd");

      expect(sh).toContain('case "${COPILOT_MIYO_SEARCH_SCOPE:-current}"');
      expect(sh).toContain('--folder "$COPILOT_MIYO_SEARCH_FOLDER"');
      expect(cmd).toContain('if /I "%COPILOT_MIYO_SEARCH_SCOPE%"=="unrestricted"');
      expect(cmd).toContain('--folder "%COPILOT_MIYO_SEARCH_FOLDER%"');
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3508 passes ticked folders before the vault on POSIX, splitting the list on slashes without globbing or eval", () => {
      const sh = miyoScript(".sh");

      expect(sh).toContain(
        [
          "    set -f",
          "    IFS=/",
          "    set --",
          "    for NAME in ${COPILOT_MIYO_SEARCH_EXTRA_FOLDERS:-}; do",
          '      [ -z "$NAME" ] || set -- "$@" --folder "$NAME"',
          "    done",
          "    unset IFS",
          "    set +f",
          '    OUT=$("$MIYO" search "$QUERY" -n 10 "$@" --folder "$COPILOT_MIYO_SEARCH_FOLDER" --json 2>&1)',
        ].join("\n")
      );
      expect(sh).not.toMatch(/\beval\b/);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3508 puts the agent's words last on Windows, after --, so they stay query text and cannot add a --folder", () => {
      const cmd = miyoScript(".cmd");

      expect(cmd).toContain("setlocal enableextensions disabledelayedexpansion\n");
      expect(cmd).not.toMatch(/enabledelayedexpansion|\bcall\b|!/i);
      expect(cmd.match(/^.*%\*.*$/gm)).toEqual([
        '  "%MIYO%" search %* -n 10 --json',
        '"%MIYO%" search -n 10 %COPILOT_MIYO_SEARCH_EXTRA_FOLDER_ARGS% --folder "%COPILOT_MIYO_SEARCH_FOLDER%" --json -- %*',
        '"%MIYO%" search -n 10 --folder "%COPILOT_MIYO_SEARCH_FOLDER%" --json -- %*',
      ]);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3508 retries a failed Windows search with the vault alone only when folders are ticked, without labels or the agent's words inside a block", () => {
      const cmd = miyoScript(".cmd");
      const scopeFailed =
        "  echo Miyo search could not enforce Current vault scope. Update Miyo, open it, and retry. Do not run an unrestricted search. 1>&2\n  exit /b 1\n)";

      expect(cmd).toContain(
        [
          '"%MIYO%" search -n 10 %COPILOT_MIYO_SEARCH_EXTRA_FOLDER_ARGS% --folder "%COPILOT_MIYO_SEARCH_FOLDER%" --json -- %*',
          "if not errorlevel 1 exit /b 0",
          "if not defined COPILOT_MIYO_SEARCH_EXTRA_FOLDER_ARGS (",
          scopeFailed,
          '"%MIYO%" search -n 10 --folder "%COPILOT_MIYO_SEARCH_FOLDER%" --json -- %*',
          "if errorlevel 1 (",
          scopeFailed,
          "echo Miyo search skipped the extra Miyo folders ticked in Copilot settings and searched only the active vault. 1>&2",
          "exit /b 0",
        ].join("\n")
      );
      expect(cmd).not.toMatch(/\bgoto\b|^:/m);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 omits the folder boundary only for explicit Unrestricted mode on POSIX and Windows", () => {
      const sh = miyoScript(".sh");
      const cmd = miyoScript(".cmd");

      expect(sh).toContain('unrestricted)\n    OUT=$("$MIYO" search "$QUERY" -n 10 --json');
      expect(cmd).toContain(
        'if /I "%COPILOT_MIYO_SEARCH_SCOPE%"=="unrestricted" (\n  "%MIYO%" search %* -n 10 --json'
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 fails closed when Current vault scope is missing, invalid, or unsupported", () => {
      for (const script of [miyoScript(".sh"), miyoScript(".cmd")]) {
        expect(script).toMatch(/active vault identity is missing/i);
        expect(script).toMatch(/invalid Search scope/i);
        expect(script).toMatch(/Do not (retry or )?run an unrestricted search/i);
        expect(script).toMatch(/Update Miyo/i);
      }
    });

    it("resolves the binary absolute-path-first with a PATH fallback, per OS", () => {
      expect(miyoScript(".sh")).toContain("$HOME/.miyo/bin/miyo");
      expect(miyoScript(".sh")).toContain("command -v miyo");
      expect(miyoScript(".cmd")).toContain("%LOCALAPPDATA%\\Miyo\\bin\\miyo\\miyo.exe");
      expect(miyoScript(".cmd")).toContain("where miyo");
    });

    it("degrades clearly when Miyo is not installed (both scripts)", () => {
      expect(miyoScript(".sh")).toMatch(/not installed/i);
      expect(miyoScript(".sh")).toMatch(/may not be running/i);
      expect(miyoScript(".cmd")).toMatch(/not installed/i);
    });
  });

  describe("MIYO_PARSE_SKILL", () => {
    const miyoParseScript = (ext: ".sh" | ".cmd"): string => {
      const file = MIYO_PARSE_SKILL.files.find((candidate) => candidate.path.endsWith(ext));
      if (!file) throw new Error(`miyo-parse ships no ${ext} script`);
      return file.content;
    };

    it("is a gated skill distinct from the always-seeded set and from Miyo search", () => {
      expect(BUILTIN_SKILLS).not.toContain(MIYO_PARSE_SKILL);
      expect(MIYO_PARSE_SKILL.name).toBe("miyo-parse");
      expect(MIYO_PARSE_SKILL.enabledAgents).toEqual(["claude", "codex", "opencode"]);
    });

    it("ships one wrapper per OS that runs `miyo parse` on a single quoted path", () => {
      expect(MIYO_PARSE_SKILL.files.map((file) => file.path)).toEqual([
        "miyo-parse.sh",
        "miyo-parse.cmd",
      ]);
      expect(miyoParseScript(".sh")).toContain('"$MIYO" parse "$FILE"');
      expect(miyoParseScript(".cmd")).toContain('"%MIYO%" parse "%~1"');
    });

    it("resolves Miyo's install path before falling back to PATH on each OS", () => {
      expect(miyoParseScript(".sh")).toContain("$HOME/.miyo/bin/miyo");
      expect(miyoParseScript(".sh")).toContain("command -v miyo");
      expect(miyoParseScript(".cmd")).toContain("%LOCALAPPDATA%\\Miyo\\bin\\miyo\\miyo.exe");
      expect(miyoParseScript(".cmd")).toContain("where miyo");
    });

    it("tells the agent to report a parse error and then read the file itself without retrying https://github.com/Brevilabs/obsidian-copilot-private/issues/656", () => {
      const { skillMd } = MIYO_PARSE_SKILL;
      expect(skillMd).toContain(
        "Report the error to the user, then read the file with any other tool you\nhave. Do not run `miyo parse` again on that file."
      );
      expect(skillMd).not.toMatch(/never fall back|copilot-read-pdf|\bPlus\b/i);
    });

    it("does not embed Copilot Plus credentials", () => {
      expect(MIYO_PARSE_SKILL.skillMd).not.toContain(PLUS_ENV.licenseKey);
      expect(MIYO_PARSE_SKILL.skillMd).not.toContain(PLUS_ENV.baseUrl);
      expect(miyoParseScript(".sh")).not.toContain(PLUS_ENV.licenseKey);
      expect(miyoParseScript(".cmd")).not.toContain(PLUS_ENV.licenseKey);
    });
  });

  describe("ALL_MANAGED_SKILLS", () => {
    it("keeps every SKILL.md frontmatter version in sync with the numeric version", () => {
      for (const skill of ALL_MANAGED_SKILLS) {
        expect(skill.skillMd).toContain(`copilot-builtin-version: "${skill.version}"`);
      }
    });

    it(`tells every script-backed skill to run through the agent's shell tool, never as code-execution code (${ISSUE_599})`, () => {
      const scripted = ALL_MANAGED_SKILLS.filter((skill) =>
        skill.files.some((file) => file.path.endsWith(".sh"))
      );
      expect(scripted.map((skill) => skill.name)).toEqual([
        "copilot-web-search",
        "copilot-web-fetch",
        "copilot-youtube-transcript",
        "copilot-fetch-x",
        "openartifacts-publish",
        "miyo-search",
        "miyo-parse",
      ]);
      for (const skill of scripted) {
        expect(skill.skillMd).toContain(
          "`Bash` in Claude Code, `shell` in OpenCode, `exec_command` in Codex"
        );
        expect(skill.skillMd).toContain("never pass it as the code of a\ncode-execution tool");
      }
    });
  });

  describe("planManagedBuiltins()", () => {
    const names = (skills: readonly { name: string }[]): string[] => skills.map((s) => s.name);

    it("seeds only the always-on builtins when both Miyo gates are off", () => {
      const plan = planManagedBuiltins({ search: false, documents: false });
      expect(plan.seed).toBe(BUILTIN_SKILLS);
      expect(plan.prune).toEqual(["miyo-search", "miyo-parse"]);
    });

    it("gates search and document parsing independently", () => {
      expect(names(planManagedBuiltins({ search: true, documents: false }).seed)).toEqual([
        ...names(BUILTIN_SKILLS),
        "miyo-search",
      ]);
      expect(planManagedBuiltins({ search: true, documents: false }).prune).toEqual(["miyo-parse"]);
      expect(names(planManagedBuiltins({ search: false, documents: true }).seed)).toEqual([
        ...names(BUILTIN_SKILLS),
        "miyo-parse",
      ]);
      expect(planManagedBuiltins({ search: false, documents: true }).prune).toEqual([
        "miyo-search",
      ]);
    });

    it("seeds both Miyo skills and prunes nothing when both gates are on", () => {
      const plan = planManagedBuiltins({ search: true, documents: true });
      expect(names(plan.seed)).toEqual([...names(BUILTIN_SKILLS), "miyo-search", "miyo-parse"]);
      expect(plan.prune).toEqual([]);
    });
  });

  describe("DEFAULT_BUILTIN_PREFERENCES", () => {
    it("stores web search and web fetch as opt-outs so older releases keep them https://github.com/Brevilabs/obsidian-copilot-private/issues/629", () => {
      expect(DEFAULT_BUILTIN_PREFERENCES).toEqual({
        "copilot-web-search": { disabled: true },
        "copilot-web-fetch": { disabled: true },
      });
      expect(DEFAULT_SETTINGS.agentMode.skills.builtinPreferences).toBe(
        DEFAULT_BUILTIN_PREFERENCES
      );
    });
  });

  describe("isMiyoSearchSkillActive()", () => {
    const issue = "https://github.com/Brevilabs/obsidian-copilot-private/issues/716";

    it.each([
      [true, true, true],
      [true, false, false],
      [false, true, false],
      [false, false, false],
    ])(
      `with Miyo connected=%s and the switch=%s the skill is active=%s ${issue}`,
      (enableMiyo, enableMiyoSearchSkill, active) => {
        expect(isMiyoSearchSkillActive({ enableMiyo, enableMiyoSearchSkill })).toBe(active);
      }
    );
  });

  describe("isBuiltinSkillEnabledFor()", () => {
    it("enables every seeded builtin for every agent when no preference is stored", () => {
      const settings = settingsWith({}, { enableMiyoDocumentProcessing: false });
      for (const agent of ["claude", "codex", "opencode"]) {
        expect(isBuiltinSkillEnabledFor(settings, "copilot-web-search", agent)).toBe(true);
      }
    });

    it("keeps default-off skills off for every agent in a fresh install https://github.com/Brevilabs/obsidian-copilot-private/issues/629", () => {
      for (const agent of ["claude", "codex", "opencode"]) {
        for (const name of Object.keys(DEFAULT_BUILTIN_PREFERENCES)) {
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

    it("follows the Miyo gates: each Miyo skill needs its setting", () => {
      const off = settingsWith(
        {},
        { enableMiyo: true, enableMiyoSearchSkill: false, enableMiyoDocumentProcessing: false }
      );
      expect(isBuiltinSkillEnabledFor(off, "miyo-search", "claude")).toBe(false);
      expect(isBuiltinSkillEnabledFor(off, "miyo-parse", "claude")).toBe(false);

      const on = settingsWith(
        {},
        { enableMiyo: true, enableMiyoSearchSkill: true, enableMiyoDocumentProcessing: true }
      );
      expect(isBuiltinSkillEnabledFor(on, "miyo-search", "claude")).toBe(true);
      expect(isBuiltinSkillEnabledFor(on, "miyo-parse", "claude")).toBe(true);
    });

    it("keeps miyo-search off while Miyo is disconnected even though its switch defaults on (https://github.com/Brevilabs/obsidian-copilot-private/issues/716)", () => {
      const disconnected = settingsWith({}, { enableMiyo: false, enableMiyoSearchSkill: true });
      expect(isBuiltinSkillEnabledFor(disconnected, "miyo-search", "claude")).toBe(false);
    });

    it("reports a name that is not a managed builtin as disabled", () => {
      expect(isBuiltinSkillEnabledFor(settingsWith({}), "user-authored", "claude")).toBe(false);
    });
  });
});
