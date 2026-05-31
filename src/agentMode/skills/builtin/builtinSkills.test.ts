import { BUILTIN_SKILLS, PLUS_ENV } from "./builtinSkills";

/** The single script file shipped by a skill. */
function scriptOf(name: string): string {
  const skill = BUILTIN_SKILLS.find((s) => s.name === name);
  if (!skill) throw new Error(`no builtin skill ${name}`);
  return skill.files[0].content;
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

  it("invokes the script with sh (not node) and references the matching script file", () => {
    for (const skill of BUILTIN_SKILLS) {
      const scriptFile = skill.files[0].path;
      expect(scriptFile).toMatch(/\.sh$/);
      expect(skill.skillMd).toContain(`sh "/absolute/path/to/this/skill/directory/${scriptFile}"`);
      expect(skill.skillMd).not.toContain("node ");
    }
  });

  it("reads its config from the injected env and never embeds a key", () => {
    for (const skill of BUILTIN_SKILLS) {
      const script = skill.files[0].content;
      expect(script).toContain(`#!/bin/sh`);
      expect(script).toContain(PLUS_ENV.licenseKey);
      expect(script).toContain(PLUS_ENV.baseUrl);
      // Auth flows through the env var, not a literal embedded key.
      expect(script).toContain("Authorization: Bearer $KEY");
      expect(script).toContain("X-Client-Version: $CLIENT_VERSION");
      // Guard + upgrade prompt when the license/relay config is absent.
      expect(script).toContain('[ -n "$KEY" ] && [ -n "$BASE" ] || die "$UPGRADE"');
      expect(script).toContain("Copilot Plus");
    }
  });

  it("maps each relay tool to its endpoint and request body", () => {
    expect(scriptOf("copilot-web-search")).toContain('relay "/websearch"');
    expect(scriptOf("copilot-web-search")).toContain('\\"query\\"');
    expect(scriptOf("copilot-youtube-transcript")).toContain('relay "/youtube4llm"');
    expect(scriptOf("copilot-fetch-x")).toContain('relay "/twitter4llm"');
    // Single-arg tools JSON-escape the argument they pass.
    expect(scriptOf("copilot-web-search")).toContain('$(json_escape "$ARG")');
  });

  it("read-pdf base64-encodes the file into the pdf field", () => {
    const pdf = scriptOf("copilot-read-pdf");
    expect(pdf).toContain('relay "/pdf4llm"');
    expect(pdf).toContain("base64");
    expect(pdf).toContain('\\"pdf\\"');
  });
});
