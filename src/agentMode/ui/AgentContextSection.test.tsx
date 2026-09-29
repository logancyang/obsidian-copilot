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

    expect(screen.getByText(/notes\/research/)).toBeTruthy();
    expect(screen.getByText(/Intro/)).toBeTruthy();
    expect(screen.getByText("Drag files / folders here")).toBeTruthy();
  });
});
