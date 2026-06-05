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
  it("ships the four Copilot-branded skills, each fanned out to all three agents", () => {
    expect(BUILTIN_SKILLS.map((s) => s.name)).toEqual([
      "copilot-web-search",
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
      // Guard + upgrade prompt when the license/relay config is absent.
      expect(sh).toContain('[ -n "$KEY" ] && [ -n "$BASE" ] || die "$UPGRADE"');
      expect(sh).toContain("Copilot Plus");

      const mjs = scriptOf(skill.name, ".mjs");
      expect(mjs).toContain(`#!/usr/bin/env node`);
      expect(mjs).toContain(`process.env.${PLUS_ENV.licenseKey}`);
      expect(mjs).toContain(`process.env.${PLUS_ENV.baseUrl}`);
      expect(mjs).toContain('Authorization: "Bearer " + KEY');
      expect(mjs).toContain('"X-Client-Version": CLIENT_VERSION');
      // Same license guard as the shell script.
      expect(mjs).toContain("if (!KEY || !BASE) die(UPGRADE);");
      expect(mjs).toContain("Copilot Plus");
    }
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
