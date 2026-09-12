import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { BUILTIN_SKILLS } from "@/builtinSkills/builtinSkills";

const windows = process.platform === "win32";
const WRAPPER_TIMEOUT_MS = 60_000;

interface CapturedRequest {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  contentType: string | undefined;
  body: string;
}

interface CannedResponse {
  status: number;
  body: string;
}

// Every construct the JSON encoder has to get right: quotes, backslashes, tabs, CR,
// other control characters, non-ASCII, a closing script tag, printf metacharacters,
// a line that is only a backslash, and a trailing newline.
const HTML = [
  "<!doctype html>",
  '<html lang="zh"><head><title>Tab\there "quoted" \\ back\\slash</title></head>',
  "<body>\r",
  '<div\fclass="note">\u0001\u001f</div>',
  "\\",
  "<p>100% done &amp; 中文 émoji 🚀 </script></p>",
  "</body></html>",
  "",
].join("\n");

describe("openArtifactsPublishWrappers", () => {
  // Windows runners can exceed 20 seconds on the first PowerShell invocation.
  // Allow cold startup, including up to four sequential invocations in one test.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/394
  jest.setTimeout(4 * WRAPPER_TIMEOUT_MS + 10_000);

  let root: string;
  let wrapper: string;
  let htmlFile: string;
  let server: Server;
  let origin: string;
  let requests: CapturedRequest[];
  let canned: CannedResponse;

  beforeAll(async () => {
    server = createServer((request: IncomingMessage, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
      });
      request.on("end", () => {
        requests.push({
          method: request.method,
          url: request.url,
          authorization: request.headers.authorization,
          contentType: request.headers["content-type"],
          body,
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
      body: '{"docId":"9f2k4mvq7t0xbz3n","url":"https://x/d/9f","version":1}',
    };
    root = mkdtempSync(path.join(tmpdir(), "copilot publish test "));
    const skill = BUILTIN_SKILLS.find((item) => item.name === "openartifacts-publish")!;
    for (const file of skill.files.filter((item) => !item.path.includes("/"))) {
      writeFileSync(path.join(root, file.path), file.content);
    }
    wrapper = path.join(root, `openartifacts-publish.${windows ? "ps1" : "sh"}`);
    htmlFile = path.join(root, "page.html");
    writeFileSync(htmlFile, HTML);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  interface RunResult {
    status: number | null;
    stdout: string;
    stderr: string;
  }

  // The mock server runs on this same event loop, so the wrapper has to run
  // asynchronously: a blocking spawnSync would leave curl waiting on a request
  // Node can never answer.
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
            COPILOT_PLUS_LICENSE_KEY: "test-license-key",
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

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/394 publishes a new page with the exact HTML bytes and the license key as a bearer token", async () => {
    const result = await run(["publish", htmlFile, "My “Note”"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(canned.body);
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/api/v1/docs");
    expect(request.authorization).toBe("Bearer test-license-key");
    expect(request.contentType).toMatch(/^application\/json/);
    expect(JSON.parse(request.body)).toEqual({ title: "My “Note”", html: HTML });
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/394 updates the existing page when a document id is supplied", async () => {
    canned = {
      status: 200,
      body: '{"docId":"9f2k4mvq7t0xbz3n","url":"https://x/d/9f","version":2}',
    };
    const result = await run(["publish", htmlFile, "Note", "9f2k4mvq7t0xbz3n"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(canned.body);
    expect(requests[0].method).toBe("PUT");
    expect(requests[0].url).toBe("/api/v1/docs/9f2k4mvq7t0xbz3n");
    expect(JSON.parse(requests[0].body).html).toBe(HTML);
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/394 withdraws a page with DELETE and reports the id it removed", async () => {
    canned = { status: 204, body: "" };
    const result = await run(["unshare", "9f2k4mvq7t0xbz3n"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ docId: "9f2k4mvq7t0xbz3n", status: "unshared" });
    expect(requests[0].method).toBe("DELETE");
    expect(requests[0].url).toBe("/api/v1/docs/9f2k4mvq7t0xbz3n");
    expect(requests[0].authorization).toBe("Bearer test-license-key");
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/394 treats not_found on withdrawal as already unshared", async () => {
    canned = {
      status: 404,
      body: '{"error":{"code":"not_found","message":"Document not found."}}',
    };
    const result = await run(["unshare", "9f2k4mvq7t0xbz3n"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ docId: "9f2k4mvq7t0xbz3n", status: "unshared" });
    expect(requests).toHaveLength(1);

    // A bare 404 from a proxy or a wrong host is not evidence the page is gone.
    requests.length = 0;
    canned = { status: 404, body: "<html>not here</html>" };
    const bare = await run(["unshare", "9f2k4mvq7t0xbz3n"]);
    expect(bare.status).toBe(1);
    expect(bare.stdout).toBe("");
    expect(bare.stderr).toContain("HTTP 404");
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/394 relays the server's status and error body verbatim without retrying", async () => {
    canned = {
      status: 401,
      body: '{"error":{"code":"unauthorized","message":"This plan cannot publish."}}',
    };
    const result = await run(["publish", htmlFile, "Note"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("HTTP 401");
    expect(result.stderr).toContain("This plan cannot publish.");
    expect(requests).toHaveLength(1);
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/394 refuses to run without a license key, an unknown command, or a malformed id, and sends nothing", async () => {
    const noKey = await run(["publish", htmlFile, "Note"], { COPILOT_PLUS_LICENSE_KEY: "" });
    expect(noKey.status).toBe(1);
    expect(noKey.stderr).toContain("Copilot Plus license key");

    const badCommand = await run(["review", htmlFile]);
    expect(badCommand.status).toBe(1);
    expect(badCommand.stderr).toContain("Usage:");

    const badId = await run(["unshare", "../etc/passwd"]);
    expect(badId.status).toBe(1);
    expect(badId.stderr).toContain("Invalid OpenArtifacts document id");

    const missingFile = await run(["publish", path.join(root, "missing.html"), "Note"]);
    expect(missingFile.status).toBe(1);
    expect(missingFile.stderr).toContain("HTML file not found");

    expect(requests).toHaveLength(0);
  });
});
