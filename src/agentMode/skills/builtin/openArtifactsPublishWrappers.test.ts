import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { BUILTIN_SKILLS } from "@/builtinSkills/builtinSkills";
import { OPENARTIFACTS_CLI_VERSION } from "@/openArtifacts/constants";

const windows = process.platform === "win32";
const WRAPPER_TIMEOUT_MS = 60_000;
// A stub npx runs the installed CLI, so the tests reach the real CLI without the network.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/746
const CLI_BIN = require.resolve("openartifacts/bin/openartifacts.js");

interface CapturedRequest {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  client: string | undefined;
}

interface CannedResponse {
  status: number;
  body: string;
}

describe("openArtifactsPublishWrappers", () => {
  // Windows runners can exceed 20 seconds on the first PowerShell invocation. https://github.com/Brevilabs/obsidian-copilot-private/issues/394
  jest.setTimeout(4 * WRAPPER_TIMEOUT_MS + 10_000);

  let root: string;
  let stubDir: string;
  let npxLog: string;
  let wrapper: string;
  let htmlFile: string;
  let server: Server;
  let origin: string;
  let requests: CapturedRequest[];
  let canned: CannedResponse;

  beforeAll(async () => {
    server = createServer((request: IncomingMessage, response) => {
      request.resume();
      request.on("end", () => {
        requests.push({
          method: request.method,
          url: request.url,
          authorization: request.headers.authorization,
          client: request.headers["x-openartifacts-client"] as string | undefined,
        });
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
    requests = [];
    canned = {
      status: 201,
      body: '{"docId":"9f2k4mvq7t0xbz3n","url":"https://x/d/9f","version":1,"linkAccess":"invited"}',
    };
    root = mkdtempSync(path.join(tmpdir(), "copilot publish test "));
    const skill = BUILTIN_SKILLS.find((item) => item.name === "openartifacts-publish")!;
    for (const file of skill.files.filter((item) => !item.path.includes("/"))) {
      writeFileSync(path.join(root, file.path), file.content);
    }
    wrapper = path.join(root, `openartifacts-publish.${windows ? "ps1" : "sh"}`);
    htmlFile = path.join(root, "page.html");
    writeFileSync(htmlFile, "<p>Page</p>");

    stubDir = path.join(root, "bin");
    mkdirSync(stubDir);
    npxLog = path.join(root, "npx.log");
    if (windows) {
      writeFileSync(
        path.join(stubDir, "npx.ps1"),
        `Add-Content -LiteralPath $env:NPX_LOG -Value ($args -join ' ')\n` +
          `$rest = @($args | Select-Object -Skip 2)\n` +
          `& '${process.execPath}' '${CLI_BIN}' @rest\n` +
          `exit $LASTEXITCODE\n`
      );
    } else {
      writeFileSync(
        path.join(stubDir, "npx"),
        `#!/bin/sh\nprintf '%s\\n' "$*" >> "$NPX_LOG"\nshift 2\nexec '${process.execPath}' '${CLI_BIN}' "$@"\n`,
        { mode: 0o755 }
      );
    }
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  interface RunResult {
    status: number | null;
    stdout: string;
    stderr: string;
  }

  function run(args: string[], env: Record<string, string | undefined> = {}): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        windows ? "powershell.exe" : "sh",
        [
          ...(windows ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"] : []),
          wrapper,
          ...args,
        ],
        {
          timeout: WRAPPER_TIMEOUT_MS,
          env: {
            ...process.env,
            PATH: `${stubDir}${path.delimiter}${process.env.PATH ?? ""}`,
            NPX_LOG: npxLog,
            COPILOT_PLUS_LICENSE_KEY: "test-license-key",
            OPENARTIFACTS_TOKEN: "someone-elses-token",
            OPENARTIFACTS_CONFIG_DIR: path.join(root, "config"),
            OPENARTIFACTS_API_HOST: origin,
            OPENARTIFACTS_WORKSPACE_ROOT: root,
            ...env,
          },
        }
      );
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (status) => resolve({ status, stdout, stderr }));
    });
  }

  it("runs the pinned openartifacts CLI with the license key as its credential", async () => {
    const result = await run(["publish", htmlFile, "--title", "My “Note”"]);

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(readFileSync(npxLog, "utf8").trim()).toBe(
      `--yes openartifacts@${OPENARTIFACTS_CLI_VERSION} publish ${htmlFile} --title My “Note”`
    );
    expect(requests.map((item) => [item.method, item.url, item.authorization])).toEqual([
      ["POST", "/api/v1/private-docs", "Bearer test-license-key"],
    ]);
    expect(JSON.parse(result.stdout)).toMatchObject({
      docId: "9f2k4mvq7t0xbz3n",
      linkAccess: "invited",
      manageUrl: `${origin}/share/9f2k4mvq7t0xbz3n`,
    });
  });

  it("pins the same CLI release as the openartifacts dependency whose themes it bundles", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(__dirname, "../../../../package.json"), "utf8")
    ) as { devDependencies: Record<string, string> };
    expect(manifest.devDependencies.openartifacts).toBe(OPENARTIFACTS_CLI_VERSION);
  });

  describe("account-link offer", () => {
    const GUIDANCE_BODY =
      '{"docId":"9f2k4mvq7t0xbz3n","url":"https://x/d/9f","version":1,"linkAccess":"invited","guidance":{"message":"Link your account.","url":"https://openartifacts.ai/account"}}';
    const markerPath = () => path.join(root, ".openartifacts", "link-offer-shown");

    it("https://github.com/Brevilabs/OpenArtifacts/issues/94 asks for the offer on a new page while the marker is absent, and records it only when the receipt carries guidance", async () => {
      const plain = await run(["publish", htmlFile, "--public"]);
      expect(plain.status).toBe(0);
      expect(requests[0].client).toBe("obsidian-copilot");
      expect(existsSync(markerPath())).toBe(false);

      canned = { status: 201, body: GUIDANCE_BODY };
      const offered = await run(["publish", htmlFile, "--private"]);
      expect(offered.status).toBe(0);
      expect(requests[1].client).toBe("obsidian-copilot");
      expect(JSON.parse(offered.stdout).guidance).toEqual({
        message: "Link your account.",
        url: "https://openartifacts.ai/account",
      });
      expect(existsSync(markerPath())).toBe(true);

      await run(["publish", htmlFile]);
      expect(requests[2].client).toBeUndefined();
    });

    it("https://github.com/Brevilabs/OpenArtifacts/issues/94 never asks on an update or another command", async () => {
      canned = { status: 200, body: GUIDANCE_BODY };

      await run(["publish", htmlFile, "--doc-id", "9f2k4mvq7t0xbz3n"]);
      await run(["share", "9f2k4mvq7t0xbz3n"]);

      expect(requests.map((item) => item.client)).toEqual([undefined, undefined]);
      expect(existsSync(markerPath())).toBe(false);
    });

    it("https://github.com/Brevilabs/OpenArtifacts/issues/94 still succeeds quietly when the marker cannot be written", async () => {
      writeFileSync(path.join(root, ".openartifacts"), "");
      canned = { status: 201, body: GUIDANCE_BODY };

      const result = await run(["publish", htmlFile]);

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).guidance).toBeDefined();
      expect(result.stderr).toBe("");
    });

    it("https://github.com/Brevilabs/OpenArtifacts/issues/94 never asks, and still publishes, without a workspace root", async () => {
      const result = await run(["publish", htmlFile], { OPENARTIFACTS_WORKSPACE_ROOT: "" });

      expect(result.status).toBe(0);
      expect(requests[0].client).toBeUndefined();
    });
  });

  it("refuses to run without a license key, without Node.js, or for a sign-in or account command", async () => {
    const noKey = await run(["publish", htmlFile], { COPILOT_PLUS_LICENSE_KEY: "" });
    expect(noKey.status).toBe(1);
    expect(noKey.stderr).toContain("Copilot Plus license key");

    for (const command of ["login", "account", "review"]) {
      const refused = await run([command]);
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain("Usage:");
    }

    const systemDir = windows ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32") : "";
    const noNode = await run(["publish", htmlFile], {
      PATH: windows
        ? `${systemDir};${path.join(systemDir, "WindowsPowerShell", "v1.0")}`
        : "/usr/bin:/bin",
    });
    expect(noNode.status).toBe(1);
    expect(noNode.stderr).toContain("needs Node.js");

    expect(existsSync(npxLog)).toBe(false);
    expect(requests).toHaveLength(0);
  });
});
