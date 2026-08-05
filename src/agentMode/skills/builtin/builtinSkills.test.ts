import {
  BUILTIN_SKILLS,
  MIYO_PARSE_SKILL,
  MIYO_SEARCH_SKILL,
  planManagedBuiltins,
  PLUS_ENV,
} from "./builtinSkills";
import {
  SYMPOSIUM_AGENT_HANDOFF_DIR,
  SYMPOSIUM_MAX_HTML_BYTES,
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

    it("hands finished agent HTML to the host without exposing publication controls", () => {
      const skill = BUILTIN_SKILLS.find((item) => item.name === "symposium-publish");
      expect(skill).toBeDefined();
      expect(skill!.version).toBe(8);
      expect(skill!.files.map((file) => file.path)).toEqual([
        "symposium-publish.sh",
        "symposium-publish.cmd",
        "symposium-publish.ps1",
      ]);
      expect(skill!.skillMd).toContain("Require one existing Markdown source file");
      expect(skill!.skillMd).toContain("delete, remove, or");
      expect(skill!.skillMd).toContain("the user alone chooses Update or Delete");
      expect(skill!.skillMd).toContain("never render the raw frontmatter block");
      expect(skill!.skillMd).toContain("Never tell the user to delete the page at its public URL");
      expect(skill!.skillMd).toMatch(/static HTML or\s+SVG/);
      expect(skill!.skillMd).toContain("handlers, redirects, or external assets");
      expect(skill!.skillMd).toContain(`\`${SYMPOSIUM_MAX_HTML_BYTES}\` bytes`);
      expect(skill!.skillMd).toContain(SYMPOSIUM_WORKSPACE_ROOT_ENV);
      expect(skill!.skillMd).toContain(SYMPOSIUM_AGENT_HANDOFF_DIR);
      expect(skill!.skillMd).toMatch(/sandboxed\s+local-browser rendering/);
      expect(skill!.skillMd).toMatch(/rejects active or\s+externally loaded content/);
      expect(skill!.skillMd).toMatch(/prevents navigation from the\s+browser preview/);
      expect(skill!.skillMd).toMatch(/never\s+choose an action or document id/);
      expect(skill!.skillMd).toContain("create a new complete artifact");
      expect(skill!.skillMd).toContain("previous confirmation never applies");
      expect(skill!.skillMd).toMatch(/removes the\s+original artifact/);
      expect(skill!.skillMd).toContain("removes its temporary browser preview");
      expect(skill!.skillMd).toContain("bypass the review");
      expect(skill!.skillMd).toContain("address every listed issue");
      expect(skill!.skillMd).toContain("retry exactly once");
      expect(skill!.skillMd).toContain("Never invent a cause");
      expect(skill!.skillMd).toMatch(/create\s+another filename/);
      expect(skill!.skillMd).toContain("`deleted`");
      expect(skill!.skillMd).not.toContain("SYMPOSIUM_TOKEN");
      expect(skill!.skillMd).not.toContain(PLUS_ENV.licenseKey);
      expect(skill!.skillMd).not.toContain("/api/v1/docs");
      expect(skill!.skillMd).not.toContain("Bearer");
      expect(skill!.skillMd).not.toContain("POST exactly");
      expect(skill!.skillMd).not.toContain("publish-history.md");

      for (const script of [
        scriptOf("symposium-publish", ".sh"),
        scriptOf("symposium-publish", ".ps1"),
      ]) {
        expect(script).toContain("reviewAgentManage");
        expect(script).toContain("reviewAgentPublish");
        expect(script).toContain("then(JSON.stringify)");
        expect(script).toContain("symposiumAgentBridge");
        expect(script).not.toContain("symposiumPublisher");
        expect(script).toContain(SYMPOSIUM_WORKSPACE_ROOT_ENV);
        expect(script).not.toContain("SYMPOSIUM_VAULT_NAME");
        expect(script).toContain("A compatible Obsidian CLI is unavailable.");
        expect(script).not.toContain("COPILOT_OBSIDIAN_CLI:-obsidian");
        expect(script).not.toContain("SYMPOSIUM_TOKEN");
        expect(script).not.toContain(PLUS_ENV.licenseKey);
        expect(script).not.toContain("/api/v1/docs");
      }

      const sh = scriptOf("symposium-publish", ".sh");
      expect(sh).toContain('cd "$WORKSPACE_ROOT"');
      expect(sh).toContain("VAULT_NAME=${WORKSPACE_ROOT%/}");
      expect(sh).toContain('CLI_OUTPUT=$("$OBSIDIAN_CLI" "vault=$VAULT_NAME" eval');
      expect(sh).toContain("sed -n '/^=> {/p' | sed -n '$p'");
      expect(sh).not.toContain("trap cleanup");
      expect(sh).not.toContain("rm -f");

      const ps1 = scriptOf("symposium-publish", ".ps1");
      expect(ps1).toContain("Set-Location -LiteralPath $WORKSPACE_ROOT");
      expect(ps1).toContain("$VAULT_NAME = Split-Path -Leaf (Get-Location).Path");
      expect(ps1).toContain("$CLI_OUTPUT = & $OBSIDIAN_CLI \"vault=$VAULT_NAME\" 'eval'");
      expect(ps1).toContain("Where-Object { ([string]$_).StartsWith('=> {') }");
      expect(ps1).not.toContain("finally {");
      expect(ps1).not.toContain("Remove-Item");
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

    it("tells the agent to fail closed rather than reach for a cloud parser", () => {
      expect(MIYO_PARSE_SKILL.skillMd).toMatch(/Never fall back/i);
      expect(MIYO_PARSE_SKILL.skillMd).toContain("copilot-read-pdf");
    });

    it("names the recovery path when the CLI is absent, since a remote server can't parse", () => {
      // `miyo parse` runs locally and never reads MIYO_URL, so a remote-only
      // user has to install the CLI or move the picker back to Plus.
      expect(MIYO_PARSE_SKILL.skillMd).toMatch(/remote\s+Miyo\s+server\s+does\s+not\s+help/i);
      expect(MIYO_PARSE_SKILL.skillMd).toMatch(/Document\s+Processor to Plus/i);
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
  });
});
