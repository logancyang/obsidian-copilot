import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BUILTIN_SKILLS,
  PLUS_ENV,
  SELF_HOST_WEB_SEARCH_ENV,
  SELF_HOST_WEB_SEARCH_TOKEN_ENV,
  SELF_HOST_WEB_SEARCH_URL_ENV,
} from "@/builtinSkills/builtinSkills";

const ISSUE_3398 = "https://github.com/logancyang/obsidian-copilot/issues/3398";
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
    arg = "https://youtu.be/q7mD8NFYd7s",
    mockTransportFailure = false
  ): Promise<{ status: number | null; stdout: string; stderr: string }> {
    const skill = BUILTIN_SKILLS.find((item) => item.name === skillName)!;
    for (const file of skill.files) writeFileSync(path.join(root, file.path), file.content);
    const script = skill.files.find((file) => file.path.endsWith(windows ? ".ps1" : ".sh"))!;
    const args = mockTransportFailure
      ? [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `function Invoke-WebRequest { throw [System.Net.WebException]::new('Diagnostic transport failure') }; & '${path.join(root, script.path).replace(/'/g, "''")}' 'test query'`,
        ]
      : [
          ...(windows ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"] : []),
          path.join(root, script.path),
          arg,
        ];
    return new Promise((resolve, reject) => {
      const child = spawn(windows ? "powershell.exe" : "sh", args, {
        timeout: WRAPPER_TIMEOUT_MS,
        env: { ...process.env, ...env },
      });
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
  describe("Windows request diagnostics", () => {
    const windowsIt = windows ? it : it.skip;

    windowsIt.each([
      ["copilot-web-search", false],
      ["copilot-web-fetch", false],
      ["copilot-youtube-transcript", false],
      ["copilot-fetch-x", false],
      ["copilot-web-search", true],
    ])(
      "https://github.com/logancyang/obsidian-copilot/issues/4177 preserves the transport exception from %s with Self-Host routing %s",
      async (skillName, selfHost) => {
        const result = await run(
          skillName,
          {
            ...relayEnv(),
            [SELF_HOST_WEB_SEARCH_ENV]: selfHost ? "1" : "",
            [SELF_HOST_WEB_SEARCH_URL_ENV]: origin,
            [SELF_HOST_WEB_SEARCH_TOKEN_ENV]: "test-token",
          },
          "test query",
          true
        );
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("System.Net.WebException: Diagnostic transport failure");
        expect(result.stderr).not.toContain("test-token");
        expect(result.stderr).not.toContain("test-license");
      }
    );
  });

  it("https://github.com/logancyang/obsidian-copilot/issues/4177 preserves the Self-Host provider error body", async () => {
    canned = {
      status: 500,
      body: JSON.stringify({ error: `Provider rejected the search: ${TEXT}` }),
    };
    const result = await run("copilot-web-search", {
      [SELF_HOST_WEB_SEARCH_ENV]: "1",
      [SELF_HOST_WEB_SEARCH_URL_ENV]: origin,
      [SELF_HOST_WEB_SEARCH_TOKEN_ENV]: "test-token",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(canned.body);
  });
});
