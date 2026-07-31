import {
  BUILTIN_SKILLS,
  MIYO_PARSE_SKILL,
  MIYO_SEARCH_SKILL,
  planManagedBuiltins,
  PLUS_ENV,
} from "./builtinSkills";
import {
  SYMPOSIUM_API_ORIGIN,
  SYMPOSIUM_MAX_HTML_BYTES,
  SYMPOSIUM_TOKEN_ENV,
  SYMPOSIUM_WORKSPACE_ROOT_ENV,
} from "@/symposium/constants";

/** A script file shipped by a skill, matched by extension (".sh", ".cmd", ".ps1"). */
function scriptOf(name: string, ext: ".sh" | ".cmd" | ".ps1" = ".sh"): string {
  const skill = BUILTIN_SKILLS.find((s) => s.name === name);
  if (!skill) throw new Error(`no builtin skill ${name}`);
  const file = skill.files.find((f) => f.path.endsWith(ext));
  if (!file) throw new Error(`skill ${name} ships no ${ext} script`);
  return file.content;
}

const RELAY_SKILLS = BUILTIN_SKILLS.filter((skill) => skill.name.startsWith("copilot-"));

describe("builtinSkills", () => {
  describe("BUILTIN_SKILLS", () => {
    it("ships the approved Plus and Obsidian skills to all three agents", () => {
      expect(BUILTIN_SKILLS.map((s) => s.name)).toEqual([
        "copilot-web-search",
        "copilot-web-fetch",
        "copilot-read-pdf",
        "copilot-youtube-transcript",
        "copilot-fetch-x",
        "symposium-publish",
        "obsidian-markdown",
        "obsidian-bases",
        "json-canvas",
        "obsidian-cli",
      ]);
      for (const skill of BUILTIN_SKILLS) {
        expect(skill.enabledAgents).toEqual(["claude", "codex", "opencode"]);
      }
    });

    it("keeps the SKILL.md frontmatter version in sync with the numeric version", () => {
      for (const skill of BUILTIN_SKILLS) {
        expect(skill.skillMd).toContain(`copilot-builtin-version: "${skill.version}"`);
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
        // The three scripts share a base name (web-search.sh ↔ .cmd ↔ .ps1).
        expect(cmd!.path).toBe(sh!.path.replace(/\.sh$/, ".cmd"));
        expect(ps1!.path).toBe(sh!.path.replace(/\.sh$/, ".ps1"));
        // SKILL.md routes macOS/Linux at sh and Windows at the cmd wrapper (run
        // with PowerShell's `&` call operator), with no Node anywhere.
        expect(skill.skillMd).toContain(`sh "/absolute/path/to/this/skill/directory/${sh!.path}"`);
        expect(skill.skillMd).toContain(`& "/absolute/path/to/this/skill/directory/${cmd!.path}"`);
        expect(skill.skillMd).not.toContain("install Node.js");
        expect(skill.skillMd).not.toContain("node ");
        // No Node runtime ships anymore.
        expect(skill.files.some((f) => f.path.endsWith(".mjs"))).toBe(false);
        // The cmd launcher drives the sibling ps1 via Windows PowerShell with the
        // execution policy relaxed, locating it relative to its own folder.
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
        // Auth flows through the env var, not a literal embedded key.
        expect(sh).toContain("Authorization: Bearer $KEY");
        expect(sh).toContain("X-Client-Version: $CLIENT_VERSION");
        // Guard + soft fallback when the license/relay config is absent.
        expect(sh).toContain('[ -n "$KEY" ] && [ -n "$BASE" ] || no_license');
        expect(sh).toContain("Copilot Plus");

        const ps1 = scriptOf(skill.name, ".ps1");
        expect(ps1).toContain(`[Environment]::GetEnvironmentVariable('${PLUS_ENV.licenseKey}')`);
        expect(ps1).toContain(`[Environment]::GetEnvironmentVariable('${PLUS_ENV.baseUrl}')`);
        expect(ps1).toContain('Authorization = "Bearer $KEY"');
        expect(ps1).toContain("'X-Client-Version' = $CLIENT_VERSION");
        // Same license guard as the shell script.
        expect(ps1).toContain("if (-not $KEY -or -not $BASE) { NoLicense }");
        expect(ps1).toContain("Copilot Plus");
        // The body is sent as explicit UTF-8 bytes — Windows PowerShell 5.1 would
        // otherwise ASCII-encode a string body and corrupt non-ASCII input.
        expect(ps1).toContain("[System.Text.Encoding]::UTF8.GetBytes($json)");
        expect(ps1).toContain("application/json; charset=utf-8");
        expect(ps1).toContain("-Body $bytes");
        // Output side: force UTF-8 so non-ASCII relay output isn't mojibaked by
        // Windows PowerShell 5.1's default code-page console encoding.
        expect(ps1).toContain("[Console]::OutputEncoding = [System.Text.Encoding]::UTF8");
        expect(ps1).toContain("$OutputEncoding = [System.Text.Encoding]::UTF8");
      }
    });

    it("falls back to the agent's own tools instead of blocking when Plus is absent", () => {
      for (const skill of RELAY_SKILLS) {
        const sh = scriptOf(skill.name, ".sh");
        // No license: tell the agent to use its own equivalent tools, never
        // refuse, and only append the upsell occasionally (gated on the pid). The
        // fallback wording is generic (not web-specific) so it suits the PDF skill
        // too, which shares this message.
        expect(sh).toContain("your own equivalent built-in tools");
        expect(sh).not.toContain("web tools");
        expect(sh).toContain("never refuse");
        expect(sh).toContain("$(( $$ % 4 ))");
        // The upsell carries the actionable instruction to obtain a license key.
        expect(sh).toContain("get a license key at https://www.obsidiancopilot.com");
        // The invalid/expired-license (401/403) path is distinct and warrants a
        // renewal note, but still falls back rather than refusing.
        expect(sh).toContain('401|403) die "$LICENSE_INVALID"');
        expect(sh).toContain("renew their Copilot Plus license");
        // The old hard "requires Copilot Plus / upgrade" block is gone.
        expect(sh).not.toContain("require Copilot Plus");

        // A non-license relay failure (unreachable, or a non-2xx that isn't
        // 401/403 — e.g. a page that can't be fetched) still routes the agent to
        // its own tool rather than dead-ending the request.
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

    it("includes the firecrawl-backed web-fetch skill targeting /url4llm", () => {
      expect(scriptOf("copilot-web-fetch", ".sh")).toContain('relay "/url4llm"');
      expect(scriptOf("copilot-web-fetch", ".sh")).toContain('\\"url\\"');
      expect(scriptOf("copilot-web-fetch", ".ps1")).toContain('Invoke-Relay "/url4llm"');
      expect(scriptOf("copilot-web-fetch", ".ps1")).toContain(
        "@{ url = $ARG; user_id = $USER_ID }"
      );
    });

    it("maps each relay tool to its endpoint and request body (both scripts)", () => {
      expect(scriptOf("copilot-web-search", ".sh")).toContain('relay "/websearch"');
      expect(scriptOf("copilot-web-search", ".sh")).toContain('\\"query\\"');
      expect(scriptOf("copilot-youtube-transcript", ".sh")).toContain('relay "/youtube4llm"');
      expect(scriptOf("copilot-fetch-x", ".sh")).toContain('relay "/twitter4llm"');
      // Single-arg tools JSON-escape the argument they pass.
      expect(scriptOf("copilot-web-search", ".sh")).toContain('$(json_escape "$ARG")');

      // The PowerShell sibling hits the same endpoints with a structured body.
      expect(scriptOf("copilot-web-search", ".ps1")).toContain('Invoke-Relay "/websearch"');
      expect(scriptOf("copilot-web-search", ".ps1")).toContain(
        "@{ query = $ARG; user_id = $USER_ID }"
      );
      expect(scriptOf("copilot-youtube-transcript", ".ps1")).toContain(
        'Invoke-Relay "/youtube4llm"'
      );
      expect(scriptOf("copilot-fetch-x", ".ps1")).toContain('Invoke-Relay "/twitter4llm"');
    });

    it("read-pdf base64-encodes the file into the pdf field (both scripts)", () => {
      const sh = scriptOf("copilot-read-pdf", ".sh");
      expect(sh).toContain('relay "/pdf4llm"');
      expect(sh).toContain("base64");
      expect(sh).toContain('\\"pdf\\"');

      const ps1 = scriptOf("copilot-read-pdf", ".ps1");
      expect(ps1).toContain('Invoke-Relay "/pdf4llm"');
      expect(ps1).toContain(
        "[System.Convert]::ToBase64String([System.IO.File]::ReadAllBytes($FILE))"
      );
      expect(ps1).toContain("@{ pdf = $PDF; user_id = $USER_ID }");
    });

    it("publishes confirmed agent-generated HTML and retains the link on its source note", () => {
      const skill = BUILTIN_SKILLS.find((item) => item.name === "symposium-publish");
      expect(skill).toBeDefined();
      expect(skill!.files).toEqual([]);
      expect(skill!.skillMd).toContain("Require one existing Markdown source file");
      expect(skill!.skillMd).toMatch(/static HTML or\s+SVG/);
      expect(skill!.skillMd).toContain(`\`${SYMPOSIUM_MAX_HTML_BYTES}\` bytes`);
      expect(skill!.skillMd).toContain("ask an explicit Yes/No confirmation");
      expect(skill!.skillMd).toContain("A previous");
      expect(skill!.skillMd).toContain("request to publish is not confirmation");
      expect(skill!.skillMd).toContain(SYMPOSIUM_TOKEN_ENV);
      expect(skill!.skillMd).not.toContain(PLUS_ENV.licenseKey);
      expect(skill!.skillMd).toContain("empty or absent");
      expect(skill!.skillMd).toContain(`${SYMPOSIUM_API_ORIGIN}/api/v1/docs`);
      expect(skill!.skillMd).toContain("POST exactly once");
      expect(skill!.skillMd).toContain("Accept: application/json");
      expect(skill!.skillMd).toContain("`User-Agent: Symposium-Agent`");
      expect(skill!.skillMd).toContain("error.code");
      expect(skill!.skillMd).toContain("Cloudflare 1xxx");
      expect(skill!.skillMd).toContain("says nothing about token validity");
      expect(skill!.skillMd).toContain("positive safe integer");
      expect(skill!.skillMd).toContain("/d/<docId>");
      expect(skill!.skillMd).toContain("malformed");
      expect(skill!.skillMd).toContain("ambiguous and non-retryable");
      expect(skill!.skillMd).toContain(".symposium/publish-history.md");
      expect(skill!.skillMd).toContain(SYMPOSIUM_WORKSPACE_ROOT_ENV);
      expect(skill!.skillMd).toContain("project-scoped");
      expect(skill!.skillMd).toContain("| Document ID | Status | Note | URL |");
      expect(skill!.skillMd).toContain("direct filesystem");
      expect(skill!.skillMd).toContain("append only when it begins with that exact");
      expect(skill!.skillMd).toContain("Escape existing backslashes");
      expect(skill!.skillMd).toContain("structured frontmatter API");
      expect(skill!.skillMd).toContain("server's full `url`");
      expect(skill!.skillMd).toMatch(/only if the property is still\s+absent/);
      expect(skill!.skillMd).toContain("server's `url` verbatim");
      expect(skill!.skillMd).not.toContain("Copilot Plus");
      expect(skill!.skillMd).not.toContain("Copilot-Obsidian");
      expect(skill!.skillMd).not.toContain("Obsidian CLI");
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
      // Windows is shown with the PowerShell call operator `&` (a bare quoted
      // path is a string in PowerShell and wouldn't run).
      expect(MIYO_SEARCH_SKILL.skillMd).toContain(
        `& "/absolute/path/to/this/skill/directory/miyo-search.cmd"`
      );
      // No Node runtime anywhere — neither a .mjs file nor a node invocation.
      expect(MIYO_SEARCH_SKILL.files.some((f) => f.path.endsWith(".mjs"))).toBe(false);
      expect(MIYO_SEARCH_SKILL.skillMd).not.toContain("node ");
    });

    it("keeps the SKILL.md frontmatter version in sync with the numeric version", () => {
      expect(MIYO_SEARCH_SKILL.skillMd).toContain(
        `copilot-builtin-version: "${MIYO_SEARCH_SKILL.version}"`
      );
    });

    it("embeds no Plus license env — Miyo is a local loopback CLI", () => {
      expect(MIYO_SEARCH_SKILL.skillMd).not.toContain(PLUS_ENV.licenseKey);
      expect(MIYO_SEARCH_SKILL.skillMd).not.toContain(PLUS_ENV.baseUrl);
      expect(miyoScript(".sh")).not.toContain(PLUS_ENV.licenseKey);
      expect(miyoScript(".cmd")).not.toContain(PLUS_ENV.licenseKey);
    });

    it("documents concrete triggers for when to call it", () => {
      const md = MIYO_SEARCH_SKILL.skillMd;
      // The description is the agent's primary "when to use" signal.
      expect(md).toMatch(/description:[^\n]*too slow/i);
      expect(md).toMatch(/description:[^\n]*explicitly asks for Miyo search/i);
      // The body reinforces the same triggers.
      expect(md).toMatch(/When to use it/);
      expect(md).toMatch(/doesn't surface enough relevant notes/i);
    });

    it("runs one deterministic `miyo search ... --json` in each script", () => {
      expect(miyoScript(".sh")).toContain('search "$QUERY"');
      expect(miyoScript(".sh")).toContain("--json");
      expect(miyoScript(".cmd")).toContain("search %* -n 10 --json");
    });

    it("resolves the binary absolute-path-first with a PATH fallback, per OS", () => {
      // POSIX (.sh): absolute install path tried before falling back to PATH.
      expect(miyoScript(".sh")).toContain("$HOME/.miyo/bin/miyo");
      expect(miyoScript(".sh")).toContain("command -v miyo");
      // Windows (.cmd): the %LOCALAPPDATA% install, then PATH.
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
      expect(MIYO_PARSE_SKILL.skillMd).toContain(
        `copilot-builtin-version: "${MIYO_PARSE_SKILL.version}"`
      );
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

    it("rejects a missing or unreadable file before invoking the CLI", () => {
      // Without this the agent only sees the CLI's own error and cannot tell a
      // bad (e.g. vault-relative) path from a broken Miyo install.
      expect(miyoParseScript(".sh")).toContain('[ -f "$FILE" ] && [ -r "$FILE" ]');
      expect(miyoParseScript(".cmd")).toContain('if not exist "%~1"');
    });

    it("tells the agent to fail closed rather than reach for a cloud parser", () => {
      expect(MIYO_PARSE_SKILL.skillMd).toMatch(/Never fall back/i);
      expect(MIYO_PARSE_SKILL.skillMd).toContain("copilot-read-pdf");
    });

    it("does not embed Copilot Plus credentials", () => {
      expect(MIYO_PARSE_SKILL.skillMd).not.toContain(PLUS_ENV.licenseKey);
      expect(MIYO_PARSE_SKILL.skillMd).not.toContain(PLUS_ENV.baseUrl);
      expect(miyoParseScript(".sh")).not.toContain(PLUS_ENV.licenseKey);
      expect(miyoParseScript(".cmd")).not.toContain(PLUS_ENV.licenseKey);
    });
  });

  describe("planManagedBuiltins()", () => {
    const names = (skills: readonly { name: string }[]): string[] => skills.map((s) => s.name);

    it("seeds only the always-on builtins when both Miyo gates are off", () => {
      const plan = planManagedBuiltins({ search: false, documents: false });
      // Stable reference, per the project's referential-stability rule.
      expect(plan.seed).toBe(BUILTIN_SKILLS);
      expect(plan.prune).toEqual(["miyo-search", "miyo-parse"]);
    });

    it("gates search and document parsing independently", () => {
      expect(names(planManagedBuiltins({ search: true, documents: false }).seed)).toEqual([
        ...names(BUILTIN_SKILLS),
        "miyo-search",
      ]);
      expect(planManagedBuiltins({ search: true, documents: false }).prune).toEqual(["miyo-parse"]);
      expect(planManagedBuiltins({ search: false, documents: true }).seed).toContain(
        MIYO_PARSE_SKILL
      );
      expect(planManagedBuiltins({ search: false, documents: true }).prune).toContain(
        "miyo-search"
      );
    });

    it("replaces the cloud PDF skill with Miyo parse when Miyo owns documents", () => {
      // Steering alone would leave copilot-read-pdf on disk, one ignored
      // instruction away from uploading a document the user chose to keep local.
      const plan = planManagedBuiltins({ search: true, documents: true });
      expect(names(plan.seed)).not.toContain("copilot-read-pdf");
      expect(plan.prune).toEqual(["copilot-read-pdf"]);
      expect(names(plan.seed)).toEqual([
        ...names(BUILTIN_SKILLS).filter((name) => name !== "copilot-read-pdf"),
        "miyo-search",
        "miyo-parse",
      ]);
    });

    it("never leaves a managed skill both seeded and pruned", () => {
      for (const search of [true, false]) {
        for (const documents of [true, false]) {
          const plan = planManagedBuiltins({ search, documents });
          expect(names(plan.seed).filter((name) => plan.prune.includes(name))).toEqual([]);
        }
      }
    });
  });
});
