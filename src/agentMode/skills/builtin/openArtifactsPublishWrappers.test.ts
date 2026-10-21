import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
  client: string | undefined;
  body: string;
}

interface CannedResponse {
  status: number;
  body: string;
}

const DOC_ID = "9f2k4mvq7t0xbz3n";
const COMMENT_BODY = 'He said "hi" \\ back\\slash\nline two\ttab 中文 émoji 🚀';

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
  // Windows runners can exceed 20 seconds on the first PowerShell invocation. https://github.com/Brevilabs/obsidian-copilot-private/issues/394
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
          client: request.headers["x-openartifacts-client"] as string | undefined,
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

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/707 publishes privately through the private route with only the title and html", async () => {
    canned = {
      status: 201,
      body: '{"docId":"9f2k4mvq7t0xbz3n","url":"https://x/d/9f","version":1,"linkAccess":"invited"}',
    };
    const result = await run(["publish", "--private", htmlFile, "Note"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("POST");
    expect(requests[0].url).toBe("/api/v1/private-docs");
    expect(requests[0].authorization).toBe("Bearer test-license-key");
    expect(JSON.parse(requests[0].body)).toEqual({ title: "Note", html: HTML });
    expect(JSON.parse(result.stdout)).toEqual({
      ...JSON.parse(canned.body),
      manageUrl: `${origin}/share/9f2k4mvq7t0xbz3n`,
    });
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/707 stops with a not-supported message and no further request when the private route answers 404", async () => {
    canned = { status: 404, body: "<html>not here</html>" };
    const result = await run(["publish", "--private", htmlFile, "Note"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("does not support private documents. Nothing was published.");
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/api/v1/private-docs");
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/707 relays a privateSharing refusal without retrying or falling back", async () => {
    canned = {
      status: 402,
      body: '{"error":{"code":"limit_reached","message":"Your Copilot plan does not include private sharing.","limit":"privateSharing"}}',
    };
    const result = await run(["publish", "--private", htmlFile, "Note"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("HTTP 402");
    expect(result.stderr).toContain("privateSharing");
    expect(requests).toHaveLength(1);
  });

  describe("account-link offer", () => {
    const GUIDANCE_BODY =
      '{"docId":"9f2k4mvq7t0xbz3n","url":"https://x/d/9f","version":1,"guidance":{"message":"Link your account.","url":"https://openartifacts.ai/account"}}';
    const markerPath = () => path.join(root, ".openartifacts", "link-offer-shown");

    it("https://github.com/Brevilabs/OpenArtifacts/issues/94 asks for the offer on public and private creates while the marker is absent, and records it only when the receipt carries guidance", async () => {
      const plain = await run(["publish", htmlFile, "Note"]);
      expect(plain.status).toBe(0);
      expect(requests[0].client).toBe("obsidian-copilot");
      expect(existsSync(markerPath())).toBe(false);

      canned = { status: 201, body: GUIDANCE_BODY };
      const offered = await run(["publish", "--private", htmlFile, "Note"]);
      expect(offered.status).toBe(0);
      expect(requests[1].url).toBe("/api/v1/private-docs");
      expect(requests[1].client).toBe("obsidian-copilot");
      expect(JSON.parse(offered.stdout).guidance).toEqual({
        message: "Link your account.",
        url: "https://openartifacts.ai/account",
      });
      expect(existsSync(markerPath())).toBe(true);
    });

    it("https://github.com/Brevilabs/OpenArtifacts/issues/94 does not ask again once the marker exists, whether the app or an earlier run wrote it", async () => {
      mkdirSync(path.join(root, ".openartifacts"));
      writeFileSync(markerPath(), "");

      const result = await run(["publish", htmlFile, "Note"]);

      expect(result.status).toBe(0);
      expect(requests[0].client).toBeUndefined();
    });

    it("https://github.com/Brevilabs/OpenArtifacts/issues/94 never asks on an update", async () => {
      canned = { status: 200, body: GUIDANCE_BODY };

      const result = await run(["publish", htmlFile, "Note", "9f2k4mvq7t0xbz3n"]);

      expect(result.status).toBe(0);
      expect(requests[0].client).toBeUndefined();
      expect(existsSync(markerPath())).toBe(false);
    });

    it("https://github.com/Brevilabs/OpenArtifacts/issues/94 still succeeds quietly when the marker cannot be written", async () => {
      writeFileSync(path.join(root, ".openartifacts"), "");
      canned = { status: 201, body: GUIDANCE_BODY };
      const result = await run(["publish", htmlFile, "Note"]);

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).guidance).toBeDefined();
      expect(result.stderr).toBe("");
      expect(existsSync(markerPath())).toBe(false);
    });

    it("https://github.com/Brevilabs/OpenArtifacts/issues/94 never asks, and still publishes, without a workspace root", async () => {
      const result = await run(["publish", htmlFile, "Note"], { OPENARTIFACTS_WORKSPACE_ROOT: "" });

      expect(result.status).toBe(0);
      expect(requests[0].client).toBeUndefined();
    });
  });

  describe("share", () => {
    const ACCESS =
      '{"docId":"9f2k4mvq7t0xbz3n","url":"https://x/d/9f","linkAccess":"invited","email":true,"people":[],"requests":[]}';

    beforeEach(() => {
      canned = { status: 200, body: ACCESS };
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/707 adds one person, then prints the list with the share page", async () => {
      const added = await run(["share", "9f2k4mvq7t0xbz3n", "add", "alice@acme.com"]);
      expect(added.stderr).toBe("");
      expect(added.status).toBe(0);
      expect(requests[0].method).toBe("PUT");
      expect(requests[0].url).toBe("/api/v1/docs/9f2k4mvq7t0xbz3n/access/people/alice%40acme.com");
      expect(requests[0].authorization).toBe("Bearer test-license-key");
      expect(JSON.parse(added.stdout)).toEqual({
        ...JSON.parse(ACCESS),
        manageUrl: `${origin}/share/9f2k4mvq7t0xbz3n`,
      });

      requests.length = 0;
      const listed = await run(["share", "9f2k4mvq7t0xbz3n"]);
      expect(listed.status).toBe(0);
      expect(requests).toHaveLength(1);
      expect(requests[0].method).toBe("GET");
      expect(requests[0].url).toBe("/api/v1/docs/9f2k4mvq7t0xbz3n/access");
      expect(JSON.parse(listed.stdout)).toMatchObject({ linkAccess: "invited", email: true });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/746 sends a role only when one is given, and only with add", async () => {
      const plain = await run(["share", DOC_ID, "add", "alice@acme.com"]);
      expect(plain.status).toBe(0);
      expect(requests[0].body).toBe("");

      const viewer = await run(["share", DOC_ID, "add", "alice@acme.com", "--role", "view"]);
      expect(viewer.stderr).toBe("");
      expect(viewer.status).toBe(0);
      expect(requests[1].method).toBe("PUT");
      expect(requests[1].url).toBe(`/api/v1/docs/${DOC_ID}/access/people/alice%40acme.com`);
      expect(requests[1].authorization).toBe("Bearer test-license-key");
      expect(requests[1].contentType).toMatch(/^application\/json/);
      expect(JSON.parse(requests[1].body)).toEqual({ role: "view" });
      expect(JSON.parse(viewer.stdout).manageUrl).toBe(`${origin}/share/${DOC_ID}`);

      await run(["share", DOC_ID, "add", "alice@acme.com", "--role", "comment"]);
      expect(JSON.parse(requests[2].body)).toEqual({ role: "comment" });

      requests.length = 0;
      for (const args of [
        ["add", "alice@acme.com", "--role", "edit"],
        ["remove", "alice@acme.com", "--role", "view"],
        ["add", "alice@acme.com", "--role"],
      ]) {
        const refused = await run(["share", DOC_ID, ...args]);
        expect(refused.status).toBe(1);
        expect(refused.stderr).toContain("Usage:");
      }
      expect(requests).toHaveLength(0);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/707 encodes a plus sign in the address and removes or declines one address per call", async () => {
      await run(["share", "9f2k4mvq7t0xbz3n", "remove", "a+b@c.co"]);
      await run(["share", "9f2k4mvq7t0xbz3n", "decline", "bob@other.com"]);
      expect(requests.map((item) => [item.method, item.url])).toEqual([
        ["DELETE", "/api/v1/docs/9f2k4mvq7t0xbz3n/access/people/a%2Bb%40c.co"],
        ["DELETE", "/api/v1/docs/9f2k4mvq7t0xbz3n/access/requests/bob%40other.com"],
      ]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/707 switches the link access with a JSON body", async () => {
      const result = await run(["share", "9f2k4mvq7t0xbz3n", "link", "anyone"]);
      expect(result.status).toBe(0);
      expect(requests[0].method).toBe("PUT");
      expect(requests[0].url).toBe("/api/v1/docs/9f2k4mvq7t0xbz3n/access");
      expect(requests[0].contentType).toMatch(/^application\/json/);
      expect(JSON.parse(requests[0].body)).toEqual({ linkAccess: "anyone" });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/707 refuses addresses that could change the request path and sends nothing", async () => {
      for (const address of ["a/b@c.co", "a b@c.co", "a?b@c.co", "a#b@c.co", "a%40@c.co"]) {
        const result = await run(["share", "9f2k4mvq7t0xbz3n", "add", address]);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Invalid email address");
      }
      const badMode = await run(["share", "9f2k4mvq7t0xbz3n", "link", "everyone"]);
      expect(badMode.status).toBe(1);
      expect(badMode.stderr).toContain("Usage:");
      const badId = await run(["share", "../etc/passwd"]);
      expect(badId.status).toBe(1);
      expect(badId.stderr).toContain("Invalid OpenArtifacts document id");
      expect(requests).toHaveLength(0);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/707 explains a 404 as not found or unsupported, and relays other errors with their body", async () => {
      canned = { status: 404, body: "<html>not here</html>" };
      const missing = await run(["share", "9f2k4mvq7t0xbz3n"]);
      expect(missing.status).toBe(1);
      expect(missing.stdout).toBe("");
      expect(missing.stderr).toContain(
        "Not found, or this server does not support private documents."
      );

      canned = {
        status: 402,
        body: '{"error":{"code":"limit_reached","message":"Private sharing needs a paid plan.","limit":"privateSharing"}}',
      };
      const refused = await run(["share", "9f2k4mvq7t0xbz3n", "add", "alice@acme.com"]);
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain("HTTP 402");
      expect(refused.stderr).toContain("privateSharing");
    });
  });

  describe("open", () => {
    const GRANT = "http://127.0.0.1:9/open/grant?code=secret-grant-code";
    let opened: string;

    function stubOpener(exitCode: number): Record<string, string> {
      const bin = path.join(root, "bin");
      mkdirSync(bin);
      opened = path.join(root, "opened.txt");
      for (const name of ["open", "xdg-open"]) {
        const stub = path.join(bin, name);
        writeFileSync(stub, `#!/bin/sh\nprintf '%s' "$1" > "${opened}"\nexit ${exitCode}\n`);
        chmodSync(stub, 0o755);
      }
      return { PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    }

    beforeEach(() => {
      canned = { status: 200, body: JSON.stringify({ url: GRANT, expiresAt: 1785000060000 }) };
    });

    (windows ? it.skip : it)(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/746 asks for the page's open link, hands it to the browser, and never prints it",
      async () => {
        const result = await run(["open", DOC_ID], stubOpener(0));
        expect(result.stderr).toBe("");
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({ opened: true, docId: DOC_ID });
        expect(readFileSync(opened, "utf8")).toBe(GRANT);
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe("POST");
        expect(requests[0].url).toBe(`/api/v1/docs/${DOC_ID}/open`);
        expect(requests[0].authorization).toBe("Bearer test-license-key");
        expect(requests[0].body).toBe("");
      }
    );

    (windows ? it.skip : it)(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/746 points at the share page, still without the link, when no browser starts",
      async () => {
        const result = await run(["open", DOC_ID], stubOpener(1));
        expect(result.status).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain(`Could not start a browser to open ${DOC_ID}.`);
        expect(result.stderr).toContain(`${origin}/share/${DOC_ID}`);
        expect(result.stderr).not.toContain("secret-grant-code");
      }
    );

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/746 refuses a link that is not https or local, or carries credentials, without opening it", async () => {
      const env = windows ? {} : stubOpener(0);
      for (const url of [
        "javascript:alert(1)",
        "http://example.com/d/x",
        "https://user:pass@example.com/d/x",
        "file:///etc/passwd",
      ]) {
        canned = { status: 200, body: JSON.stringify({ url, expiresAt: 1785000060000 }) };
        const result = await run(["open", DOC_ID], env);
        expect(result.status).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("The server returned an invalid page link.");
      }
      if (!windows) expect(existsSync(opened)).toBe(false);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/746 explains a 404, relays other errors, and refuses a malformed id", async () => {
      canned = { status: 404, body: '{"error":{"code":"not_found","message":"Not found."}}' };
      const missing = await run(["open", DOC_ID]);
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain(
        `No document ${DOC_ID} is in this account, or this server cannot open it.`
      );

      canned = { status: 401, body: '{"error":{"code":"unauthorized","message":"Bad key."}}' };
      const refused = await run(["open", DOC_ID]);
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain("HTTP 401");
      expect(refused.stderr).toContain("Bad key.");

      requests.length = 0;
      const badId = await run(["open", "../etc/passwd"]);
      expect(badId.status).toBe(1);
      expect(badId.stderr).toContain("Invalid OpenArtifacts document id");
      const extra = await run(["open", DOC_ID, "more"]);
      expect(extra.stderr).toContain("Usage:");
      expect(requests).toHaveLength(0);
    });
  });

  describe("comments", () => {
    const THREADS = JSON.stringify({
      docId: DOC_ID,
      version: 2,
      latestVersion: 2,
      threads: [
        {
          threadId: "th_b7q3k9x2m4",
          anchor: { exact: "Revenue grew." },
          state: "open",
          comments: [{ commentId: "cm_c5r8n1t6w0", body: "Twelve percent of what? 中文 🚀" }],
        },
      ],
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/746 lists open threads by default and prints the server JSON unchanged", async () => {
      canned = { status: 200, body: THREADS };
      const result = await run(["comments", "list", DOC_ID]);
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(JSON.parse(THREADS));
      expect(requests[0].method).toBe("GET");
      expect(requests[0].url).toBe(`/api/v1/docs/${DOC_ID}/threads?state=open`);
      expect(requests[0].authorization).toBe("Bearer test-license-key");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/746 passes the state and an encoded since", async () => {
      canned = { status: 200, body: THREADS };
      const since = "2026-10-14T09:00:00+02:00";
      await run(["comments", "list", DOC_ID, "--all", "--since", since]);
      await run(["comments", "list", DOC_ID, "--since", "2026-10-14", "--resolved"]);
      const [all, resolved] = requests.map((item) => new URL(item.url!, origin));
      expect(all.pathname).toBe(`/api/v1/docs/${DOC_ID}/threads`);
      expect(all.searchParams.get("state")).toBe("all");
      expect(all.searchParams.get("since")).toBe(since);
      expect(resolved.searchParams.get("state")).toBe("resolved");
      expect(resolved.searchParams.get("since")).toBe("2026-10-14");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/746 replies with the exact body text", async () => {
      canned = { status: 201, body: '{"commentId":"cm_d2h7j4v9s3"}' };
      const result = await run([
        "comments",
        "reply",
        DOC_ID,
        "th_b7q3k9x2m4",
        "--body",
        COMMENT_BODY,
      ]);
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ commentId: "cm_d2h7j4v9s3" });
      expect(requests[0].method).toBe("POST");
      expect(requests[0].url).toBe(`/api/v1/docs/${DOC_ID}/threads/th_b7q3k9x2m4/comments`);
      expect(requests[0].authorization).toBe("Bearer test-license-key");
      expect(requests[0].contentType).toMatch(/^application\/json/);
      expect(JSON.parse(requests[0].body)).toEqual({ body: COMMENT_BODY });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/746 resolves with or without the addressing version, and reopens", async () => {
      canned = { status: 200, body: '{"threadId":"th_b7q3k9x2m4","state":"resolved"}' };
      const resolved = await run([
        "comments",
        "resolve",
        DOC_ID,
        "th_b7q3k9x2m4",
        "--version",
        "4",
      ]);
      expect(resolved.status).toBe(0);
      expect(JSON.parse(resolved.stdout)).toEqual(JSON.parse(canned.body));
      await run(["comments", "resolve", DOC_ID, "th_b7q3k9x2m4"]);
      await run(["comments", "reopen", DOC_ID, "th_b7q3k9x2m4"]);
      expect(requests.map((item) => [item.method, item.url])).toEqual([
        ["POST", `/api/v1/docs/${DOC_ID}/threads/th_b7q3k9x2m4/resolve`],
        ["POST", `/api/v1/docs/${DOC_ID}/threads/th_b7q3k9x2m4/resolve`],
        ["POST", `/api/v1/docs/${DOC_ID}/threads/th_b7q3k9x2m4/reopen`],
      ]);
      expect(JSON.parse(requests[0].body)).toEqual({ version: 4 });
      expect(JSON.parse(requests[1].body)).toEqual({});
      expect(requests[2].body).toBe("");
      for (const request of requests) expect(request.authorization).toBe("Bearer test-license-key");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/746 explains a 404 as not found or unsupported, and relays other errors with their body", async () => {
      canned = { status: 404, body: '{"error":{"code":"not_found","message":"Not found."}}' };
      const missing = await run(["comments", "list", DOC_ID]);
      expect(missing.status).toBe(1);
      expect(missing.stdout).toBe("");
      expect(missing.stderr).toContain("Not found, or this server does not support comments.");

      canned = {
        status: 402,
        body: '{"error":{"code":"limit_reached","message":"Comments need a paid plan.","limit":"comments"}}',
      };
      const refused = await run(["comments", "reply", DOC_ID, "th_b7q3k9x2m4", "--body", "Done."]);
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain("HTTP 402");
      expect(refused.stderr).toContain('"limit":"comments"');
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/746 refuses malformed ids, flags and versions, and sends nothing", async () => {
      const cases: Array<[string[], string]> = [
        [["comments", "list", "../etc/passwd"], "Invalid OpenArtifacts document id"],
        [
          ["comments", "reply", DOC_ID, "th_../x", "--body", "x"],
          "Invalid OpenArtifacts thread id",
        ],
        [["comments", "reopen", DOC_ID, "cm_c5r8n1t6w0"], "Invalid OpenArtifacts thread id"],
        [["comments", "resolve", DOC_ID, "th_b7q3k9x2m4", "--version", "0"], "--version must be"],
        [["comments", "list", DOC_ID, "--since", "yesterday"], "--since must be"],
        [["comments", "list", DOC_ID, "--open", "--all"], "Usage:"],
        [["comments", "reply", DOC_ID, "th_b7q3k9x2m4"], "Usage:"],
        [["comments", "add", DOC_ID, "--quote", "x", "--body", "y"], "Usage:"],
        [["comments", "list"], "Usage:"],
      ];
      for (const [args, message] of cases) {
        const result = await run(args);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(message);
      }
      expect(requests).toHaveLength(0);
    });
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
