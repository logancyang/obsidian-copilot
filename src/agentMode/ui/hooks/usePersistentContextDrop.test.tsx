import { usePersistentContextDrop } from "@/agentMode/ui/hooks/usePersistentContextDrop";
import type { ProjectConfig } from "@/aiParams";
import { updateCachedProjectRecords } from "@/projects/state";
import { createPatternSettingsValue, getDecodedPatterns } from "@/search/searchUtils";
import { createEvent, fireEvent, render, waitFor } from "@testing-library/react";
import { App, Notice, TFile, TFolder } from "obsidian";
import React, { useRef } from "react";

const mockUpdateProject = jest.fn().mockResolvedValue(undefined);

jest.mock("@/projects/ProjectFileManager", () => ({
  ProjectFileManager: {
    getInstance: () => ({ updateProject: mockUpdateProject }),
  },
}));

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

function seedProject(project: ProjectConfig) {
  updateCachedProjectRecords([
    { project, filePath: "Halcyon Scope/project.md", folderName: "Halcyon Scope" },
  ]);
}

/** App whose vault resolves the given path-keyed abstract files. */
function makeApp(byPath: Record<string, TFile | TFolder>): App {
  return {
    vault: {
      getAbstractFileByPath: (path: string) => byPath[path] ?? null,
    },
  } as unknown as App;
}

function Harness({ app, projectId }: { app: App; projectId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  usePersistentContextDrop({ app, projectId, dropRef: ref });
  return <div ref={ref} data-testid="zone" />;
}

interface FakeItem {
  kind: "string" | "file";
  value?: string;
}

function dispatchDrop(zone: HTMLElement, items: FakeItem[]) {
  const dataTransfer = {
    types: [] as string[],
    dropEffect: "",
    items: items.map((it) => ({
      kind: it.kind,
      getAsString: (cb: (data: string) => void) => cb(it.value ?? ""),
    })),
  };
  const event = createEvent.drop(zone);
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  fireEvent(zone, event);
}

describe("usePersistentContextDrop", () => {
  beforeEach(() => {
    mockUpdateProject.mockClear();
    (Notice as unknown as jest.Mock).mockClear();
  });
  afterEach(() => updateCachedProjectRecords([]));

  it("persists a dropped folder as a new inclusion via updateProject", async () => {
    seedProject(makeProject());
    const folder = new (TFolder as unknown as new (p: string) => TFolder)("notes/ideas");
    const app = makeApp({ "notes/ideas": folder });

    const { getByTestId } = render(<Harness app={app} projectId="p1" />);
    dispatchDrop(getByTestId("zone"), [{ kind: "string", value: "notes/ideas" }]);

    await waitFor(() => expect(mockUpdateProject).toHaveBeenCalledTimes(1));
    const [, nextConfig] = mockUpdateProject.mock.calls[0];
    expect(getDecodedPatterns(nextConfig.contextSource.inclusions)).toContain("notes/ideas");
  });

  it("persists a dropped note as a [[basename]] inclusion", async () => {
    seedProject(makeProject());
    const file = new (TFile as unknown as new (p: string) => TFile)("notes/Intro.md");
    const app = makeApp({ "notes/Intro.md": file });

    const { getByTestId } = render(<Harness app={app} projectId="p1" />);
    dispatchDrop(getByTestId("zone"), [{ kind: "string", value: "notes/Intro.md" }]);

    await waitFor(() => expect(mockUpdateProject).toHaveBeenCalledTimes(1));
    const [, nextConfig] = mockUpdateProject.mock.calls[0];
    expect(getDecodedPatterns(nextConfig.contextSource.inclusions)).toContain("[[Intro]]");
  });

  it("parses an obsidian:// URI with trailing params (file is not the last query key)", async () => {
    seedProject(makeProject());
    const file = new (TFile as unknown as new (p: string) => TFile)("notes/A.md");
    const app = makeApp({ "notes/A.md": file });

    const { getByTestId } = render(<Harness app={app} projectId="p1" />);
    dispatchDrop(getByTestId("zone"), [
      { kind: "string", value: "obsidian://open?vault=V&file=notes%2FA.md&line=3" },
    ]);

    await waitFor(() => expect(mockUpdateProject).toHaveBeenCalledTimes(1));
    const [, nextConfig] = mockUpdateProject.mock.calls[0];
    expect(getDecodedPatterns(nextConfig.contextSource.inclusions)).toContain("[[A]]");
  });

  it("is idempotent — a duplicate inclusion is not re-written", async () => {
    seedProject(
      makeProject({
        contextSource: { inclusions: createPatternSettingsValue({ notePatterns: ["[[Intro]]"] }) },
      })
    );
    const file = new (TFile as unknown as new (p: string) => TFile)("notes/Intro.md");
    const app = makeApp({ "notes/Intro.md": file });

    const { getByTestId } = render(<Harness app={app} projectId="p1" />);
    dispatchDrop(getByTestId("zone"), [{ kind: "string", value: "notes/Intro.md" }]);

    await waitFor(() =>
      expect(Notice as unknown as jest.Mock).toHaveBeenCalledWith("Already in project context")
    );
    expect(mockUpdateProject).not.toHaveBeenCalled();
  });

  it("rejects external OS files (no vault item resolved)", async () => {
    seedProject(makeProject());
    const app = makeApp({});

    const { getByTestId } = render(<Harness app={app} projectId="p1" />);
    dispatchDrop(getByTestId("zone"), [{ kind: "file" }]);

    await waitFor(() =>
      expect(Notice as unknown as jest.Mock).toHaveBeenCalledWith(
        "Only vault files or folders can be added to project context"
      )
    );
    expect(mockUpdateProject).not.toHaveBeenCalled();
  });
});
