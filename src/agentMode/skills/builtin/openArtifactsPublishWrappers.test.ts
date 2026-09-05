import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BUILTIN_SKILLS } from "./builtinSkills";

const windows = process.platform === "win32";

describe("openArtifactsPublishWrappers", () => {
  let root: string;
  let cli: string;
  let wrapper: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "copilot publish test "));
    const skill = BUILTIN_SKILLS.find((item) => item.name === "openartifacts-publish")!;
    for (const file of skill.files.filter((item) => !item.path.includes("/"))) {
      writeFileSync(path.join(root, file.path), file.content);
    }
    wrapper = path.join(root, `openartifacts-publish.${windows ? "ps1" : "sh"}`);
    cli = path.join(root, `fake-cli.${windows ? "cmd" : "sh"}`);
    if (windows) {
      writeFileSync(
        cli,
        '@echo off\r\npowershell.exe -NoProfile -File "%~dp0fake-cli.ps1"\r\nexit /b %errorlevel%\r\n'
      );
      writeFileSync(
        path.join(root, "fake-cli.ps1"),
        "[Console]::Out.WriteLine($env:MOCK_STDOUT)\n[Console]::Error.WriteLine($env:MOCK_STDERR)\nexit ([int]$env:MOCK_STATUS)\n"
      );
    } else {
      writeFileSync(
        cli,
        '#!/bin/sh\nprintf "%s\\n" "$MOCK_STDOUT"\nprintf "%s\\n" "$MOCK_STDERR" >&2\nexit "$MOCK_STATUS"\n',
        { mode: 0o700 }
      );
    }
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function run(stdout: string, stderr = "", status = 0) {
    return spawnSync(
      windows ? "powershell.exe" : "sh",
      [
        ...(windows ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"] : []),
        wrapper,
        "Notes/source.md",
        ".openartifacts/handoffs/review.html",
      ],
      {
        encoding: "utf8",
        timeout: 10000,
        env: {
          ...process.env,
          COPILOT_OBSIDIAN_CLI: cli,
          OPENARTIFACTS_WORKSPACE_ROOT: root,
          MOCK_STDOUT: stdout,
          MOCK_STDERR: stderr,
          MOCK_STATUS: String(status),
        },
      }
    );
  }

  it("returns the host outcome despite unrelated CLI diagnostics", () => {
    const result = run('Startup log\n=> {"status":"cancelled"}', "A startup warning");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('{"status":"cancelled"}');
  });

  it.each([0, 1])("preserves stdout and stderr when review fails with exit %s", (status) => {
    const result = run(
      "The CLI is unable to find Obsidian.",
      "Local IPC connection denied.",
      status
    );
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("The CLI is unable to find Obsidian.");
    expect(result.stderr).toContain("Local IPC connection denied.");
    expect(result.stdout).not.toContain('"status":"published"');
  });

  it("does not fabricate an outcome when the CLI returns no output", () => {
    const result = run("");
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Copilot could not complete the OpenArtifacts review.");
  });
});
