import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BUILTIN_SKILLS,
  MIYO_SEARCH_EXTRA_FOLDERS_ENV,
  MIYO_SEARCH_FOLDER_ENV,
  MIYO_SEARCH_SCOPE_ENV,
  MIYO_SEARCH_SKILL,
  PLUS_ENV,
  SELF_HOST_WEB_SEARCH_ENV,
  SELF_HOST_WEB_SEARCH_TOKEN_ENV,
  SELF_HOST_WEB_SEARCH_URL_ENV,
} from "@/builtinSkills/builtinSkills";

const ISSUE_3398 = "https://github.com/logancyang/obsidian-copilot/issues/3398";
const ISSUE_3508 = "https://github.com/logancyang/obsidian-copilot/issues/3508";
const windows = process.platform === "win32";
const WRAPPER_TIMEOUT_MS = 60_000;

const TEXT = "لقد قام فريق الذكاء الاصطناعي 日本語の字幕";

describe("relayWrappers", () => {
  // Windows runners can exceed 20 seconds on the first PowerShell invocation. https://github.com/Brevilabs/obsidian-copilot-private/issues/394
  jest.setTimeout(3 * WRAPPER_TIMEOUT_MS + 10_000);

  let root: string;
  let server: Server;
  let origin: string;
  let canned: { status: number; body: string };

  beforeAll(async () => {
    // A bare application/json with no charset, as the Brevilabs API sent it. https://github.com/logancyang/obsidian-copilot/issues/3398
    server = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        response.writeHead(canned.status, { "content-type": "application/json" });
        response.end(canned.body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP address");
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "copilot relay test "));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function run(
    skillName: string,
    env: Record<string, string>,
    arg = "https://youtu.be/q7mD8NFYd7s"
  ): Promise<{ status: number | null; stdout: string; stderr: string }> {
    const skill = [...BUILTIN_SKILLS, MIYO_SEARCH_SKILL].find((item) => item.name === skillName)!;
    for (const file of skill.files) writeFileSync(path.join(root, file.path), file.content);
    const script = skill.files.find((file) => file.path.endsWith(windows ? ".ps1" : ".sh"))!;
    return new Promise((resolve, reject) => {
      const child = spawn(
        windows ? "powershell.exe" : "sh",
        [
          ...(windows ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"] : []),
          path.join(root, script.path),
          arg,
        ],
        { timeout: WRAPPER_TIMEOUT_MS, env: { ...process.env, ...env } }
      );
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => (stdout += chunk));
      child.stderr.on("data", (chunk: string) => (stderr += chunk));
      child.on("error", reject);
      child.on("close", (status) => resolve({ status, stdout, stderr }));
    });
  }

  const relayEnv = () => ({ [PLUS_ENV.baseUrl]: origin, [PLUS_ENV.licenseKey]: "test-license" });

  it(`${ISSUE_3398} prints a relay response with no charset as the original UTF-8`, async () => {
    canned = { status: 200, body: JSON.stringify({ response: { transcript: TEXT } }) };
    const result = await run("copilot-youtube-transcript", relayEnv());
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(canned.body);
  });

  it(`${ISSUE_3398} reports a relay error body with no charset as the original UTF-8`, async () => {
    canned = { status: 500, body: JSON.stringify({ detail: TEXT }) };
    const result = await run("copilot-youtube-transcript", relayEnv());
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(canned.body);
  });

  it(`${ISSUE_3398} prints a Self-Host search response with no charset as the original UTF-8`, async () => {
    canned = { status: 200, body: JSON.stringify({ results: [{ title: TEXT }] }) };
    const result = await run("copilot-web-search", {
      [SELF_HOST_WEB_SEARCH_ENV]: "1",
      [SELF_HOST_WEB_SEARCH_URL_ENV]: origin,
      [SELF_HOST_WEB_SEARCH_TOKEN_ENV]: "test-token",
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(canned.body);
  });

  const FAKE_MIYO = `#!/bin/sh
printf '[%s]' "$@" >> "$HOME/calls.log"
printf '\\n' >> "$HOME/calls.log"
for ARG do
  if [ "$ARG" = "\${FAKE_MIYO_UNREGISTERED:-}" ]; then
    printf 'Error: Folder not registered: %s\\n' "$ARG" >&2
    exit 1
  fi
done
printf '[%s]\\n' "$@"
`;

  function runMiyoSearch(env: Record<string, string>) {
    const bin = path.join(root, ".miyo", "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, "miyo"), FAKE_MIYO, { mode: 0o755 });
    return run(
      "miyo-search",
      { HOME: root, [MIYO_SEARCH_SCOPE_ENV]: "current", ...env },
      "my * notes"
    );
  }

  const miyoCalls = () => readFileSync(path.join(root, "calls.log"), "utf8").trim().split("\n");
  const argv = (...args: string[]) => args.map((arg) => `[${arg}]`).join("");
  const SCOPE_FAILED =
    "Miyo search could not enforce Current vault scope. Update Miyo, open it, and retry. Do not run an unrestricted search. Details: ";

  (windows ? it.skip : it)(
    `${ISSUE_3508} hands Miyo each ticked folder verbatim, skips empty entries, and passes the vault last`,
    async () => {
      const result = await runMiyoSearch({
        [MIYO_SEARCH_FOLDER_ENV]: "My Vault",
        [MIYO_SEARCH_EXTRA_FOLDERS_ENV]: "/Research notes//*/$HOME/R&D; echo hi/-drafts/",
      });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout.trim().split("\n")).toEqual(
        [
          "search",
          "my * notes",
          "-n",
          "10",
          "--folder",
          "Research notes",
          "--folder",
          "*",
          "--folder",
          "$HOME",
          "--folder",
          "R&D; echo hi",
          "--folder",
          "-drafts",
          "--folder",
          "My Vault",
          "--json",
        ].map((arg) => `[${arg}]`)
      );
    }
  );

  (windows ? it.skip : it)(
    `${ISSUE_3508} searches only the vault when no folder is ticked`,
    async () => {
      const result = await runMiyoSearch({ [MIYO_SEARCH_FOLDER_ENV]: "My Vault" });

      expect(result.status).toBe(0);
      expect(result.stdout.trim().split("\n")).toEqual(
        ["search", "my * notes", "-n", "10", "--folder", "My Vault", "--json"].map(
          (arg) => `[${arg}]`
        )
      );
    }
  );

  (windows ? it.skip : it)(
    `${ISSUE_3508} skips ticked folders this Miyo lacks by retrying with the vault alone and noting why on stderr`,
    async () => {
      const result = await runMiyoSearch({
        [MIYO_SEARCH_FOLDER_ENV]: "My Vault",
        [MIYO_SEARCH_EXTRA_FOLDERS_ENV]: "Research/Gone",
        FAKE_MIYO_UNREGISTERED: "Gone",
      });

      expect(miyoCalls()).toEqual([
        argv(
          "search",
          "my * notes",
          "-n",
          "10",
          "--folder",
          "Research",
          "--folder",
          "Gone",
          "--folder",
          "My Vault",
          "--json"
        ),
        argv("search", "my * notes", "-n", "10", "--folder", "My Vault", "--json"),
      ]);
      expect(result.status).toBe(0);
      expect(result.stdout.trim().split("\n").join("")).toBe(
        argv("search", "my * notes", "-n", "10", "--folder", "My Vault", "--json")
      );
      expect(result.stderr).toBe(
        "Miyo search skipped the extra Miyo folders ticked in Copilot settings and searched only the active vault. Details: Error: Folder not registered: Gone\n"
      );
    }
  );

  (windows ? it.skip : it)(
    `${ISSUE_3508} reports the Current vault scope failure when the vault-alone retry also fails`,
    async () => {
      const result = await runMiyoSearch({
        [MIYO_SEARCH_FOLDER_ENV]: "My Vault",
        [MIYO_SEARCH_EXTRA_FOLDERS_ENV]: "Research",
        FAKE_MIYO_UNREGISTERED: "My Vault",
      });

      expect(miyoCalls()).toHaveLength(2);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(`${SCOPE_FAILED}Error: Folder not registered: My Vault\n`);
    }
  );

  (windows ? it.skip : it)(
    `${ISSUE_3508} fails a vault-only search without retrying when no folder is ticked`,
    async () => {
      const result = await runMiyoSearch({
        [MIYO_SEARCH_FOLDER_ENV]: "My Vault",
        FAKE_MIYO_UNREGISTERED: "My Vault",
      });

      expect(miyoCalls()).toEqual([
        argv("search", "my * notes", "-n", "10", "--folder", "My Vault", "--json"),
      ]);
      expect(result.status).toBe(1);
      expect(result.stderr).toBe(`${SCOPE_FAILED}Error: Folder not registered: My Vault\n`);
    }
  );
});
