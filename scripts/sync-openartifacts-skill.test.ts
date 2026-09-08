import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const issue = "https://github.com/logancyang/obsidian-copilot/issues/3121";

describe("sync-openartifacts-skill", () => {
  let fixture: string;

  beforeEach(() => {
    fixture = mkdtempSync(join(tmpdir(), "copilot-shared-rules-"));
    for (const path of [
      "scripts/sync-openartifacts-skill.mjs",
      "vendor/openartifacts",
      "src/agentMode/skills/builtin/openArtifactsSharedRules.ts",
    ]) {
      const destination = join(fixture, path);
      mkdirSync(join(destination, ".."), { recursive: true });
      cpSync(resolve(path), destination, { recursive: true });
    }
    symlinkSync(resolve("node_modules"), join(fixture, "node_modules"));
    // Generated formatting must use the same repository configuration.
    cpSync(resolve(".prettierrc"), join(fixture, ".prettierrc"));
  });

  afterEach(() => rmSync(fixture, { recursive: true, force: true }));

  function run(...args: string[]) {
    return execFileSync(
      process.execPath,
      [join(fixture, "scripts/sync-openartifacts-skill.mjs"), ...args],
      {
        stdio: "pipe",
      }
    );
  }

  it(`${issue} verifies bundled rules offline from the vendored canonical source`, () => {
    expect(() => run("--check")).not.toThrow();
  });

  it(`${issue} rejects a modified source that no longer matches its provenance`, () => {
    writeFileSync(join(fixture, "vendor/openartifacts/SKILL.md"), "changed");
    expect(() => run("--check")).toThrow("does not match its recorded source hash");
  });

  it(`${issue} rejects a source without the shared rules boundary`, () => {
    const source = "# No shared publishing rules\n";
    writeFileSync(join(fixture, "vendor/openartifacts/SKILL.md"), source);
    const metadataPath = join(fixture, "vendor/openartifacts/source.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as { sha256: string };
    metadata.sha256 = createHash("sha256").update(source).digest("hex");
    writeFileSync(metadataPath, JSON.stringify(metadata));
    expect(() => run("--check")).toThrow("has no shared publishing rules");
  });

  it(`${issue} detects stale bundled rules and regenerates them from the pinned snapshot`, () => {
    writeFileSync(
      join(fixture, "src/agentMode/skills/builtin/openArtifactsSharedRules.ts"),
      "stale"
    );
    expect(() => run("--check")).toThrow("differ from the vendored source");
    run();
    expect(() => run("--check")).not.toThrow();
  });
});
