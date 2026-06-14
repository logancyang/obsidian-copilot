import { BUILTIN_SKILLS, managedBuiltinSkills, MIYO_SEARCH_SKILL, PLUS_ENV } from "./builtinSkills";

/** A script file shipped by a skill, matched by extension (".sh" or ".mjs"). */
function scriptOf(name: string, ext: ".sh" | ".mjs" = ".sh"): string {
  const skill = BUILTIN_SKILLS.find((s) => s.name === name);
  if (!skill) throw new Error(`no builtin skill ${name}`);
  const file = skill.files.find((f) => f.path.endsWith(ext));
  if (!file) throw new Error(`skill ${name} ships no ${ext} script`);
  return file.content;
}

describe("builtin Copilot Plus skills", () => {
  it("ships the five Copilot-branded skills, each fanned out to all three agents", () => {
    expect(BUILTIN_SKILLS.map((s) => s.name)).toEqual([
      "copilot-web-search",
      "copilot-web-fetch",
      "copilot-read-pdf",
      "copilot-youtube-transcript",
      "copilot-fetch-x",
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

  it("ships both an sh and a node script, and documents the sh → node fallback", () => {
    for (const skill of BUILTIN_SKILLS) {
      const sh = skill.files.find((f) => f.path.endsWith(".sh"));
      const mjs = skill.files.find((f) => f.path.endsWith(".mjs"));
      expect(sh).toBeDefined();
      expect(mjs).toBeDefined();
      // The two scripts share a base name (web-search.sh ↔ web-search.mjs).
      expect(mjs!.path).toBe(sh!.path.replace(/\.sh$/, ".mjs"));
      // SKILL.md tells the agent to prefer sh, fall back to node, then prompt
      // for a Node install if neither runtime is available.
      expect(skill.skillMd).toContain(`sh "/absolute/path/to/this/skill/directory/${sh!.path}"`);
      expect(skill.skillMd).toContain(`node "/absolute/path/to/this/skill/directory/${mjs!.path}"`);
      expect(skill.skillMd).toContain("install Node.js");
    }
  });

  it("reads its config from the injected env and never embeds a key (both scripts)", () => {
    for (const skill of BUILTIN_SKILLS) {
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

      const mjs = scriptOf(skill.name, ".mjs");
      expect(mjs).toContain(`#!/usr/bin/env node`);
      expect(mjs).toContain(`process.env.${PLUS_ENV.licenseKey}`);
      expect(mjs).toContain(`process.env.${PLUS_ENV.baseUrl}`);
      expect(mjs).toContain('Authorization: "Bearer " + KEY');
      expect(mjs).toContain('"X-Client-Version": CLIENT_VERSION');
      // Same license guard as the shell script.
      expect(mjs).toContain("if (!KEY || !BASE) noLicense();");
      expect(mjs).toContain("Copilot Plus");
    }
  });

  it("falls back to the agent's own tools instead of blocking when Plus is absent", () => {
    for (const skill of BUILTIN_SKILLS) {
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

      const mjs = scriptOf(skill.name, ".mjs");
      expect(mjs).toContain("your own equivalent built-in tools");
      expect(mjs).not.toContain("web tools");
      expect(mjs).toContain("process.pid % 4 === 0");
      expect(mjs).toContain("die(LICENSE_INVALID)");
      expect(mjs).toContain("RELAY_FAILED_FALLBACK");
    }
  });

  it("includes the firecrawl-backed web-fetch skill targeting /url4llm", () => {
    expect(scriptOf("copilot-web-fetch", ".sh")).toContain('relay "/url4llm"');
    expect(scriptOf("copilot-web-fetch", ".sh")).toContain('\\"url\\"');
    expect(scriptOf("copilot-web-fetch", ".mjs")).toContain('await relay("/url4llm"');
    expect(scriptOf("copilot-web-fetch", ".mjs")).toContain("url: ARG, user_id: USER_ID");
  });

  it("maps each relay tool to its endpoint and request body (both scripts)", () => {
    expect(scriptOf("copilot-web-search", ".sh")).toContain('relay "/websearch"');
    expect(scriptOf("copilot-web-search", ".sh")).toContain('\\"query\\"');
    expect(scriptOf("copilot-youtube-transcript", ".sh")).toContain('relay "/youtube4llm"');
    expect(scriptOf("copilot-fetch-x", ".sh")).toContain('relay "/twitter4llm"');
    // Single-arg tools JSON-escape the argument they pass.
    expect(scriptOf("copilot-web-search", ".sh")).toContain('$(json_escape "$ARG")');

    // The node fallback hits the same endpoints with a structured body.
    expect(scriptOf("copilot-web-search", ".mjs")).toContain('await relay("/websearch"');
    expect(scriptOf("copilot-web-search", ".mjs")).toContain("query: ARG, user_id: USER_ID");
    expect(scriptOf("copilot-youtube-transcript", ".mjs")).toContain('await relay("/youtube4llm"');
    expect(scriptOf("copilot-fetch-x", ".mjs")).toContain('await relay("/twitter4llm"');
  });

  it("read-pdf base64-encodes the file into the pdf field (both scripts)", () => {
    const sh = scriptOf("copilot-read-pdf", ".sh");
    expect(sh).toContain('relay "/pdf4llm"');
    expect(sh).toContain("base64");
    expect(sh).toContain('\\"pdf\\"');

    const mjs = scriptOf("copilot-read-pdf", ".mjs");
    expect(mjs).toContain('await relay("/pdf4llm"');
    expect(mjs).toContain('toString("base64")');
    expect(mjs).toContain("pdf: PDF, user_id: USER_ID");
  });
});

describe("miyo-search builtin skill", () => {
  it("is a separate, Miyo-gated skill — not one of the always-seeded Plus skills", () => {
    expect(BUILTIN_SKILLS.map((s) => s.name)).not.toContain("miyo-search");
    expect(MIYO_SEARCH_SKILL.name).toBe("miyo-search");
    expect(MIYO_SEARCH_SKILL.enabledAgents).toEqual(["claude", "codex", "opencode"]);
  });

  it("ships no helper script — the miyo CLI is the runnable", () => {
    expect(MIYO_SEARCH_SKILL.files).toEqual([]);
  });

  it("keeps the SKILL.md frontmatter version in sync with the numeric version", () => {
    expect(MIYO_SEARCH_SKILL.skillMd).toContain(
      `copilot-builtin-version: "${MIYO_SEARCH_SKILL.version}"`
    );
  });

  it("embeds no Plus license env — Miyo is a local loopback CLI", () => {
    expect(MIYO_SEARCH_SKILL.skillMd).not.toContain(PLUS_ENV.licenseKey);
    expect(MIYO_SEARCH_SKILL.skillMd).not.toContain(PLUS_ENV.baseUrl);
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

  it("documents the search + files subcommands with --json output", () => {
    const md = MIYO_SEARCH_SKILL.skillMd;
    expect(md).toContain("miyo search");
    expect(md).toContain("miyo files");
    expect(md).toContain("--json");
  });

  it("resolves the binary PATH-first with a per-OS absolute fallback", () => {
    const md = MIYO_SEARCH_SKILL.skillMd;
    // macOS / Linux symlink install location.
    expect(md).toContain("~/.miyo/bin/miyo");
    // Windows copied install location.
    expect(md).toContain("\\Miyo\\bin\\miyo\\miyo.exe");
  });

  it("guides the agent through not-installed and service-down degradation", () => {
    const md = MIYO_SEARCH_SKILL.skillMd;
    expect(md).toContain("not installed");
    expect(md).toContain("Is the Miyo app running?");
  });
});

describe("managedBuiltinSkills", () => {
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
