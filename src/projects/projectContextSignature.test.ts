import type { ProjectConfig } from "@/aiParams";
import type { ProjectFileRecord } from "@/projects/type";
import {
  getProjectContextSignature,
  getProjectLandingCaptureSignature,
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
  it("changes on a System-Prompt-only edit (which the materialization signature ignores)", () => {
    const before = makeRecord(makeProject({ systemPrompt: "old" }));
    const after = makeRecord(makeProject({ systemPrompt: "new" }));
    // The materialization signature is intentionally blind to systemPrompt...
    expect(getProjectContextSignature(before)).toBe(getProjectContextSignature(after));
    // ...but the landing-capture signature must see it, so the empty landing refreshes.
    expect(getProjectLandingCaptureSignature(before)).not.toBe(
      getProjectLandingCaptureSignature(after)
    );
  });

  it("still changes on a context-source edit (folds in the materialization signature)", () => {
    const before = makeRecord(makeProject({ contextSource: { webUrls: "https://a.com" } }));
    const after = makeRecord(
      makeProject({ contextSource: { webUrls: "https://a.com\nhttps://b.com" } })
    );
    expect(getProjectLandingCaptureSignature(before)).not.toBe(
      getProjectLandingCaptureSignature(after)
    );
  });

  it("does NOT change on a usage-timestamp-only touch", () => {
    const before = makeRecord(makeProject({ systemPrompt: "same", UsageTimestamps: 1 }));
    const after = makeRecord(makeProject({ systemPrompt: "same", UsageTimestamps: 999 }));
    expect(getProjectLandingCaptureSignature(before)).toBe(
      getProjectLandingCaptureSignature(after)
    );
  });
});
