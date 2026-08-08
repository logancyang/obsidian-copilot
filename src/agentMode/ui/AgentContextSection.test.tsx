// Mock the Manage modal so its transitive Obsidian-subclass imports
// (FuzzySuggestModal, absent from the obsidian mock) don't crash module load.
jest.mock("@/components/modals/project/context-manage-modal", () => ({
  ContextManageModal: jest.fn().mockImplementation(() => ({ open: jest.fn() })),
}));

import AgentContextSection, { buildContextSummary } from "@/agentMode/ui/AgentContextSection";
import type { ProjectConfig } from "@/aiParams";
import { updateCachedProjectRecords } from "@/projects/state";
import { createPatternSettingsValue } from "@/search/searchUtils";
import { render, screen } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";

beforeAll(() => {
  // Obsidian exposes `activeDocument` as a global; jsdom doesn't. The reused
  // ProjectContextBadgeList → TruncatedText tooltip reads it on render.
  window.activeDocument = window.document;
});

function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    id: "p1",
    name: "Halcyon Scope",
    systemPrompt: "",
    projectModelKey: "",
    modelConfigs: {},
    contextSource: {},
    created: 0,
    UsageTimestamps: 0,
    ...overrides,
  };
}

describe("buildContextSummary", () => {
  it("returns an empty summary for an undefined project", () => {
    const summary = buildContextSummary(undefined);
    expect(summary.isEmpty).toBe(true);
    expect(summary.totalItems).toBe(0);
    expect(summary.urls).toBe(0);
  });

  it("returns an empty summary when the project has no context sources", () => {
    expect(buildContextSummary(makeProject()).isEmpty).toBe(true);
  });

  it("counts inclusion badges by type + URLs", () => {
    const inclusions = createPatternSettingsValue({
      folderPatterns: ["notes/research"],
      notePatterns: ["[[Intro]]"],
      tagPatterns: ["#ml"],
    });
    const project = makeProject({
      contextSource: {
        inclusions,
        webUrls: "https://arxiv.org/abs/2403",
        youtubeUrls: "https://youtu.be/xyz",
      },
    });

    const summary = buildContextSummary(project);
    expect(summary.isEmpty).toBe(false);
    expect(summary.totalItems).toBe(5);
    // Counted with the same parsers the reused badge list renders with: a note
    // pattern surfaces as a "file", plus the folder, the tag, and 2 URLs.
    expect(summary.files).toBe(1);
    expect(summary.folders).toBe(1);
    expect(summary.tags).toBe(1);
    expect(summary.urls).toBe(2);
  });
});

describe("AgentContextSection", () => {
  const app = {} as App;

  it("renders nothing for an unknown (orphaned) project", () => {
    updateCachedProjectRecords([]);
    const { container } = render(<AgentContextSection app={app} projectId="missing" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the drop hint + Manage with no header when context is empty", () => {
    updateCachedProjectRecords([
      { project: makeProject(), filePath: "Halcyon Scope/project.md", folderName: "Halcyon Scope" },
    ]);

    render(<AgentContextSection app={app} projectId="p1" />);

    // The body is headerless (the placement — standalone or tab — supplies the
    // header); it leads with the drop target and pins Manage in the footer. The
    // empty state shows the drop hint both centered and in the persistent footer.
    expect(screen.getAllByText("Drag files / folders here").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Manage/ })).toBeTruthy();
    expect(screen.queryByLabelText(/context/i)).toBeNull();
  });

  it("shows the badges + the combined drop box directly when populated", () => {
    const inclusions = createPatternSettingsValue({
      folderPatterns: ["notes/research"],
      notePatterns: ["[[Intro]]"],
    });
    updateCachedProjectRecords([
      {
        project: makeProject({ contextSource: { inclusions } }),
        filePath: "Halcyon Scope/project.md",
        folderName: "Halcyon Scope",
      },
    ]);

    render(<AgentContextSection app={app} projectId="p1" />);

    // No collapse step anymore — the reused ProjectContextBadgeList renders the
    // raw inclusion patterns immediately.
    expect(screen.getByText(/notes\/research/)).toBeTruthy();
    expect(screen.getByText(/Intro/)).toBeTruthy();
    // The chips box doubles as the drop target — its hint row is persistent.
    expect(screen.getByText("Drag files / folders here")).toBeTruthy();
  });
});
