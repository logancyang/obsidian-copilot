import {
  assembleReportBundle,
  buildReportIssueUrl,
  buildReportMarkdown,
  type ReportInput,
  type ReportRuntime,
} from "@/utils/issueReport";

function makeRuntime(overrides: Partial<ReportRuntime> = {}) {
  const writes: Array<{ path: string; data: string | Uint8Array }> = [];
  const copies: Array<{ src: string; dest: string }> = [];
  const mkdirs: string[] = [];
  const runtime: ReportRuntime = {
    join: (...parts) => parts.join("/"),
    mkdir: async (p) => {
      mkdirs.push(p);
    },
    writeFile: async (p, data) => {
      writes.push({ path: p, data });
    },
    copyFile: async (src, dest) => {
      copies.push({ src, dest });
    },
    ...overrides,
  };
  return { runtime, writes, copies, mkdirs };
}

const baseInput: ReportInput = {
  note: "Agent crashed when I clicked run",
  env: {
    pluginVersion: "1.2.3",
    platform: "darwin",
    obsidianVersion: "1.5.0",
    activeBackend: "opencode",
  },
  screenshotPng: new Uint8Array([1, 2, 3]),
  frameLogPath: "/tmp/acp-frames.ndjson",
  opencodeLogPath: "/tmp/opencode/log/session.log",
  reportsRootDir: "/tmp/reports",
  timestamp: "20260615-101500",
};

describe("assembleReportBundle", () => {
  it("creates a timestamped folder and writes all files when everything is present", async () => {
    const { runtime, writes, copies, mkdirs } = makeRuntime();
    const result = await assembleReportBundle(baseInput, runtime);

    expect(result.folderPath).toBe("/tmp/reports/report-20260615-101500");
    expect(mkdirs).toContain("/tmp/reports/report-20260615-101500");
    expect(result.files).toEqual([
      "report.md",
      "screenshot.png",
      // Bundled with a `.txt` suffix so GitHub accepts the upload (it rejects `.ndjson`).
      "acp-frames.ndjson.txt",
      "opencode.log",
    ]);

    expect(writes.map((w) => w.path)).toContain(
      "/tmp/reports/report-20260615-101500/screenshot.png"
    );
    expect(writes.map((w) => w.path)).toContain("/tmp/reports/report-20260615-101500/report.md");
    expect(copies).toEqual([
      {
        src: "/tmp/acp-frames.ndjson",
        dest: "/tmp/reports/report-20260615-101500/acp-frames.ndjson.txt",
      },
      {
        src: "/tmp/opencode/log/session.log",
        dest: "/tmp/reports/report-20260615-101500/opencode.log",
      },
    ]);
  });

  it("skips the screenshot when none was captured", async () => {
    const { runtime, writes } = makeRuntime();
    const result = await assembleReportBundle({ ...baseInput, screenshotPng: null }, runtime);

    expect(result.files).not.toContain("screenshot.png");
    expect(writes.map((w) => w.path)).not.toContain(
      "/tmp/reports/report-20260615-101500/screenshot.png"
    );
  });

  it("omits the opencode log when not provided", async () => {
    const { runtime, copies } = makeRuntime();
    const result = await assembleReportBundle({ ...baseInput, opencodeLogPath: null }, runtime);

    expect(result.files).not.toContain("opencode.log");
    expect(copies.map((c) => c.dest)).not.toContain(
      "/tmp/reports/report-20260615-101500/opencode.log"
    );
  });

  it("skips a frame log that fails to copy instead of failing the whole report", async () => {
    const { runtime } = makeRuntime({
      copyFile: async (src) => {
        if (src.includes("acp-frames")) throw new Error("ENOENT");
      },
    });
    const result = await assembleReportBundle(baseInput, runtime);

    expect(result.files).toContain("report.md");
    expect(result.files).not.toContain("acp-frames.ndjson.txt");
    expect(result.files).toContain("opencode.log");
  });

  it("always writes report.md even when nothing else is captured", async () => {
    const { runtime, writes } = makeRuntime();
    const result = await assembleReportBundle(
      { ...baseInput, screenshotPng: null, frameLogPath: null, opencodeLogPath: null },
      runtime
    );

    expect(result.files).toEqual(["report.md"]);
    const report = writes.find((w) => w.path.endsWith("report.md"));
    expect(report).toBeDefined();
    expect(String(report?.data)).toContain("Agent crashed when I clicked run");
  });
});

describe("buildReportMarkdown", () => {
  it("includes the note, environment, and attachment list", () => {
    const md = buildReportMarkdown(baseInput, ["report.md", "screenshot.png"]);
    expect(md).toContain("Agent crashed when I clicked run");
    expect(md).toContain("- Plugin version: 1.2.3");
    expect(md).toContain("- Active backend: opencode");
    expect(md).toContain("- Platform: darwin");
    expect(md).toContain("- Obsidian: 1.5.0");
    expect(md).toContain("- screenshot.png");
  });

  it("falls back to a placeholder when the note is empty", () => {
    const md = buildReportMarkdown({ ...baseInput, note: "   " }, []);
    expect(md).toContain("_No description provided._");
    expect(md).toContain("(none captured)");
  });
});

describe("buildReportIssueUrl", () => {
  it("targets the public repo with a prefilled, encoded title and body", () => {
    const url = buildReportIssueUrl(baseInput, ["report.md"]);
    expect(url.startsWith("https://github.com/logancyang/obsidian-copilot/issues/new?")).toBe(true);
    expect(url.includes("obsidian-copilot-preview")).toBe(false);
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("title")).toBe("[Agent Mode] Agent crashed when I clicked run");
    expect(params.get("labels")).toBe("bug");
    expect(params.get("body")).toContain("Agent crashed when I clicked run");
  });

  it("uses a generic title when the note is blank", () => {
    const url = buildReportIssueUrl({ ...baseInput, note: "" }, []);
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("title")).toBe("[Agent Mode] Issue report");
  });

  it("truncates the body so the URL stays under the Windows openExternal limit", () => {
    const longNote = "x".repeat(10000);
    const url = buildReportIssueUrl({ ...baseInput, note: longNote }, ["report.md"]);
    // Comfortably under Electron's ~2081-char Windows ceiling for openExternal.
    expect(url.length).toBeLessThanOrEqual(2081);
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("body")).toContain("report.md");
  });
});
