import { BUILTIN_SKILLS, managedBuiltinSkills, MIYO_SEARCH_SKILL, PLUS_ENV } from "./builtinSkills";
import { SYMPOSIUM_API_ORIGIN } from "@/symposium/constants";

/** A script file shipped by a skill, matched by extension (".sh", ".cmd", ".ps1"). */
function scriptOf(name: string, ext: ".sh" | ".cmd" | ".ps1" = ".sh"): string {
  const skill = BUILTIN_SKILLS.find((s) => s.name === name);
  if (!skill) throw new Error(`no builtin skill ${name}`);
  const file = skill.files.find((f) => f.path.endsWith(ext));
  if (!file) throw new Error(`skill ${name} ships no ${ext} script`);
  return file.content;
}

const SCRIPTED_PLUS_SKILLS = BUILTIN_SKILLS.filter((skill) => skill.name.startsWith("copilot-"));
const RELAY_SKILLS = SCRIPTED_PLUS_SKILLS.filter(
  (skill) => skill.name !== "copilot-publish-symposium"
);

describe("builtinSkills", () => {
  describe("BUILTIN_SKILLS", () => {
    it("ships the approved Plus and Obsidian skills to all three agents", () => {
      expect(BUILTIN_SKILLS.map((s) => s.name)).toEqual([
        "copilot-web-search",
        "copilot-web-fetch",
        "copilot-read-pdf",
        "copilot-youtube-transcript",
        "copilot-fetch-x",
        "copilot-publish-symposium",
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
      for (const skill of SCRIPTED_PLUS_SKILLS) {
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

    it("publishes confirmed agent-generated HTML and retains the id on its source note", () => {
      const skill = BUILTIN_SKILLS.find((item) => item.name === "copilot-publish-symposium");
      expect(skill).toBeDefined();
      expect(skill!.skillMd).toContain("complete HTML document yourself");
      expect(skill!.skillMd).toContain("static SVG");
      expect(skill!.skillMd).toContain("static table or");
      expect(skill!.skillMd).toContain("Do not publish standalone HTML without a source note");
      expect(skill!.skillMd).toContain("Ask an explicit Yes/No question");
      expect(skill!.skillMd).toContain("If that");
      expect(skill!.skillMd).toContain("UI is unavailable");
      expect(skill!.skillMd).toContain("invoke the wrapper unless the user");
      expect(skill!.skillMd).toContain("answers Yes to this confirmation");
      expect(skill!.skillMd).toContain("copilot/symposium/published-documents.md");
      expect(skill!.skillMd).toContain("Append one row; never rewrite or delete older rows");
      expect(skill!.skillMd).toContain("Only after attempting the ledger write");
      expect(skill!.skillMd).toContain("only if it is still absent");
      expect(skill!.skillMd).toContain("property:set");
      expect(skill!.skillMd).toContain("read the source note's `symposium`");
      expect(skill!.skillMd).toContain("Set it to the returned `docId`");
      expect(skill!.skillMd).toContain("return the server's");
      expect(skill!.skillMd).toContain("verbatim");

      const sh = scriptOf(skill!.name, ".sh");
      expect(sh).toContain(PLUS_ENV.licenseKey);
      expect(sh).toContain(`${SYMPOSIUM_API_ORIGIN}/api/v1/docs`);
      expect(sh).toContain('[ -f "$SOURCE" ]');
      expect(sh).toContain('json_escape < "$FILE"');
      expect(sh).toContain("Authorization: Bearer $KEY");
      expect(sh).toContain("--data-binary @-");
      expect(sh).toContain("source_is_unpublished");
      expect(sh).toContain("9007199254740991");
      expect(sh).toContain("abcdefghjkmnpqrstvwxyz");
      expect(sh).toContain("Do not retry");

      const ps1 = scriptOf(skill!.name, ".ps1");
      expect(ps1).toContain(PLUS_ENV.licenseKey);
      expect(ps1).toContain(`${SYMPOSIUM_API_ORIGIN}/api/v1/docs`);
      expect(ps1).toContain("Test-Path -LiteralPath $SOURCE");
      expect(ps1).toContain("[System.IO.File]::ReadAllText($FILE");
      expect(ps1).toContain('Authorization = "Bearer $KEY"');
      expect(ps1).toContain("-Body $BYTES");
      expect(ps1).toContain("TrimStart([char]0xFEFF)");
      expect(ps1).toContain("ConvertFrom-Json -ErrorAction Stop");
      expect(ps1).toContain("9007199254740991");
      expect(ps1).toContain("abcdefghjkmnpqrstvwxyz");
      expect(ps1).toContain("Do not retry");
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

  describe("managedBuiltinSkills()", () => {
    it("includes the Miyo skill only when Miyo is in use", () => {
      expect(managedBuiltinSkills(true)).toContain(MIYO_SEARCH_SKILL);
      expect(managedBuiltinSkills(false)).not.toContain(MIYO_SEARCH_SKILL);
    });

    it("appends Miyo after the Plus skills, preserving their order", () => {
      expect(managedBuiltinSkills(true).map((s) => s.name)).toEqual([
        ...BUILTIN_SKILLS.map((s) => s.name),
        "miyo-search",
      ]);
    });

    it("returns the stable BUILTIN_SKILLS reference when Miyo is off", () => {
      expect(managedBuiltinSkills(false)).toBe(BUILTIN_SKILLS);
    });
  });
});
