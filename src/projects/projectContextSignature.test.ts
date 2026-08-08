import type { ProjectConfig } from "@/aiParams";
import type { ProjectFileRecord } from "@/projects/type";
import { App, TFile } from "obsidian";
import {
  composeContextDirtyKey,
  contextDirtyKeyMatchesConfig,
  getProjectContextSignature,
  getProjectLandingCaptureSignature,
  landingCaptureIsVerifiable,
  normalizeProjectContextSource,
} from "./projectContextSignature";

function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    id: "p1",
    name: "Project One",
    systemPrompt: "",
    projectModelKey: "",
    modelConfigs: {},
    contextSource: {},
    created: 0,
    UsageTimestamps: 0,
    ...overrides,
  };
}

function makeRecord(
  project: ProjectConfig,
  filePath = "Projects/One/project.md"
): ProjectFileRecord {
  return { project, filePath, folderName: "One" };
}

/**
 * App whose vault knows about the given AGENTS.md files, keyed by vault path with their
 * `mtime`/`size` stat. An unlisted path resolves to null, exercising the legacy
 * `project.md`-body fallback.
 */
function makeApp(agentsFiles: Record<string, { mtime: number; size: number }> = {}): App {
  return {
    vault: {
      getAbstractFileByPath: (path: string) => {
        const stat = agentsFiles[path];
        if (!stat) return null;
        const file = new (TFile as unknown as new (path: string) => TFile)(path);
        file.stat = { ctime: 0, mtime: stat.mtime, size: stat.size };
        return file;
      },
    },
  } as unknown as App;
}

// Beside the record's own `project.md`, which is where the session cwd points, NOT under the
// live projects root the record may no longer belong to.
const AGENTS_PATH = "Projects/One/AGENTS.md";
const noAgents = makeApp();

describe("normalizeProjectContextSource", () => {
  it("trims lines, drops blanks, and rejoins", () => {
    const project = makeProject({
      contextSource: { webUrls: "  https://a.com \n\n  https://b.com  \n" },
    });
    expect(normalizeProjectContextSource(project).webUrls).toBe("https://a.com\nhttps://b.com");
  });

  it("treats undefined source fields as empty strings", () => {
    expect(normalizeProjectContextSource(makeProject())).toEqual({
      inclusions: "",
      exclusions: "",
      webUrls: "",
      youtubeUrls: "",
    });
  });

  it("ignores fields outside the context source (systemPrompt etc.)", () => {
    const a = makeProject({ systemPrompt: "old" });
    const b = makeProject({ systemPrompt: "new" });
    expect(normalizeProjectContextSource(a)).toEqual(normalizeProjectContextSource(b));
  });
});

describe("getProjectContextSignature", () => {
  it("is stable across cosmetic whitespace edits", () => {
    const a = makeRecord(makeProject({ contextSource: { webUrls: "https://a.com" } }));
    const b = makeRecord(makeProject({ contextSource: { webUrls: "  https://a.com  \n" } }));
    expect(getProjectContextSignature(a)).toBe(getProjectContextSignature(b));
  });

  it("changes when a web URL is added", () => {
    const before = makeRecord(makeProject({ contextSource: { webUrls: "https://a.com" } }));
    const after = makeRecord(
      makeProject({ contextSource: { webUrls: "https://a.com\nhttps://b.com" } })
    );
    expect(getProjectContextSignature(before)).not.toBe(getProjectContextSignature(after));
  });

  it("does NOT change on a usage-timestamp-only touch", () => {
    const before = makeRecord(makeProject({ UsageTimestamps: 1 }));
    const after = makeRecord(makeProject({ UsageTimestamps: 999 }));
    expect(getProjectContextSignature(before)).toBe(getProjectContextSignature(after));
  });

  it("changes when the project file is relocated (cache dir / cwd moves)", () => {
    const project = makeProject({ contextSource: { webUrls: "https://a.com" } });
    const before = makeRecord(project, "Projects/One/project.md");
    const after = makeRecord(project, "Projects/Renamed/project.md");
    expect(getProjectContextSignature(before)).not.toBe(getProjectContextSignature(after));
  });
});

describe("getProjectLandingCaptureSignature", () => {
  it("resolves AGENTS.md beside the record's own project.md, not under the live root", () => {
    // A Copilot-folder change activates before ProjectRegister reloads its cache. The session
    // cwd follows the record, so the fingerprint has to watch the file in that same folder.
    const record = makeRecord(makeProject(), "old-root/projects/One/project.md");
    const app = makeApp({ "old-root/projects/One/AGENTS.md": { mtime: 1000, size: 40 } });

    expect(getProjectLandingCaptureSignature(app, record)).toContain("agents:1000:40");
  });

  it("refuses to fingerprint a project under a hidden Copilot root", () => {
    // Obsidian never indexes a dot-folder, so an edit to the real AGENTS.md is invisible here
    // and the legacy body is empty once the move ran. Reporting a fingerprint that can never
    // change would let a stale empty landing be reused forever.
    const record = makeRecord(makeProject(), ".copilot/projects/One/project.md");

    const signature = getProjectLandingCaptureSignature(noAgents, record);

    expect(signature).toContain("agents:unverifiable");
    expect(landingCaptureIsVerifiable(signature)).toBe(false);
    expect(
      landingCaptureIsVerifiable(
        getProjectLandingCaptureSignature(noAgents, makeRecord(makeProject()))
      )
    ).toBe(true);
  });

  it("tracks the project's AGENTS.md, not the inert project.md body", () => {
    // AGENTS.md is what every backend actually reads from the session cwd, so an edit to it
    // must invalidate an empty landing...
    const record = makeRecord(makeProject({ systemPrompt: "unchanged" }));
    const before = makeApp({ [AGENTS_PATH]: { mtime: 1000, size: 40 } });
    const after = makeApp({ [AGENTS_PATH]: { mtime: 2000, size: 55 } });
    expect(getProjectLandingCaptureSignature(before, record)).not.toBe(
      getProjectLandingCaptureSignature(after, record)
    );

    // ...while the legacy body, which no longer reaches the agent once AGENTS.md exists,
    // must not churn the session.
    const app = makeApp({ [AGENTS_PATH]: { mtime: 1000, size: 40 } });
    expect(
      getProjectLandingCaptureSignature(app, makeRecord(makeProject({ systemPrompt: "old" })))
    ).toBe(
      getProjectLandingCaptureSignature(app, makeRecord(makeProject({ systemPrompt: "new" })))
    );
  });

  it("falls back to the project.md body until AGENTS.md exists", () => {
    // Pre-initialization the body IS the instruction source (it seeds the file), so an edit
    // to it must still refresh the landing.
    const before = makeRecord(makeProject({ systemPrompt: "old" }));
    const after = makeRecord(makeProject({ systemPrompt: "new" }));
    // The materialization signature is intentionally blind to systemPrompt...
    expect(getProjectContextSignature(before)).toBe(getProjectContextSignature(after));
    // ...but the landing-capture signature must see it.
    expect(getProjectLandingCaptureSignature(noAgents, before)).not.toBe(
      getProjectLandingCaptureSignature(noAgents, after)
    );
  });

  it("still changes on a context-source edit (folds in the materialization signature)", () => {
    const before = makeRecord(makeProject({ contextSource: { webUrls: "https://a.com" } }));
    const after = makeRecord(
      makeProject({ contextSource: { webUrls: "https://a.com\nhttps://b.com" } })
    );
    expect(getProjectLandingCaptureSignature(noAgents, before)).not.toBe(
      getProjectLandingCaptureSignature(noAgents, after)
    );
  });

  it("does NOT change on a usage-timestamp-only touch", () => {
    const before = makeRecord(makeProject({ systemPrompt: "same", UsageTimestamps: 1 }));
    const after = makeRecord(makeProject({ systemPrompt: "same", UsageTimestamps: 999 }));
    expect(getProjectLandingCaptureSignature(noAgents, before)).toBe(
      getProjectLandingCaptureSignature(noAgents, after)
    );
  });
});

describe("composeContextDirtyKey / contextDirtyKeyMatchesConfig", () => {
  const sig = getProjectContextSignature(makeRecord(makeProject()));

  it("salts a config signature with an epoch", () => {
    expect(composeContextDirtyKey(sig, 3)).toBe(`${sig}#3`);
  });

  it("matches the bare signature and any epoch-salted form of it", () => {
    expect(contextDirtyKeyMatchesConfig(sig, sig)).toBe(true);
    expect(contextDirtyKeyMatchesConfig(composeContextDirtyKey(sig, 0), sig)).toBe(true);
    expect(contextDirtyKeyMatchesConfig(composeContextDirtyKey(sig, 42), sig)).toBe(true);
  });

  it("does NOT match a different config signature", () => {
    const other = getProjectContextSignature(makeRecord(makeProject({ id: "p2" }), "Other/p.md"));
    expect(contextDirtyKeyMatchesConfig(composeContextDirtyKey(sig, 1), other)).toBe(false);
  });

  it("is undefined-safe and rejects a non-numeric suffix", () => {
    expect(contextDirtyKeyMatchesConfig(undefined, sig)).toBe(false);
    expect(contextDirtyKeyMatchesConfig(`${sig}#abc`, sig)).toBe(false);
  });
});
