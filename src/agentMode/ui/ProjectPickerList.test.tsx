jest.mock("@/components/modals/project/context-manage-modal", () => ({
  ContextManageModal: jest.fn().mockImplementation(() => ({ open: jest.fn() })),
}));

import { ProjectConfig } from "@/aiParams";
import { ProjectPickerList } from "@/agentMode/ui/ProjectPickerList";
import { RecentUsageManager } from "@/utils/recentUsageManager";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";

const app = {} as App;
const noop = () => {};

function makeProject(
  id: string,
  usageTimestamps: number,
  created = usageTimestamps
): ProjectConfig {
  return {
    id,
    name: id,
    systemPrompt: "",
    projectModelKey: "",
    modelConfigs: {},
    contextSource: {},
    created,
    UsageTimestamps: usageTimestamps,
  };
}

function renderedOrder(container: HTMLElement, names: string[]): string[] {
  const rows = Array.from(container.querySelectorAll<HTMLElement>('[role="button"]'));
  return rows
    .map((row) => names.find((name) => row.textContent?.includes(name)))
    .filter((name): name is string => Boolean(name));
}

describe("ProjectPickerList", () => {
  const originalObserver = window.IntersectionObserver;
  let callback: IntersectionObserverCallback;
  const disconnect = jest.fn();
  const observer = { disconnect, observe: jest.fn() } as unknown as IntersectionObserver;
  const intersect = (isIntersecting: boolean) =>
    callback([{ isIntersecting } as IntersectionObserverEntry], observer);

  beforeEach(() => {
    disconnect.mockClear();
    window.IntersectionObserver = jest.fn((nextCallback: IntersectionObserverCallback) => {
      callback = nextCallback;
      return observer;
    });
  });
  afterEach(() => {
    window.IntersectionObserver = originalObserver;
  });

  const projectA = makeProject("A", 1000);
  const projectB = makeProject("B", 2000);
  const projectC = makeProject("C", 3000);
  const names = ["A", "B", "C"];

  function renderPicker(manager?: RecentUsageManager<string>) {
    return render(
      <ProjectPickerList
        projects={[projectA, projectB, projectC]}
        onSelect={noop}
        app={app}
        projectUsageTimestampsManager={manager}
      />
    );
  }

  describe("ProjectPickerList()", () => {
    it("renders projects in most-recently-used order from persisted timestamps when no usage manager is provided", () => {
      const { container } = renderPicker();
      expect(renderedOrder(container, names)).toEqual(["C", "B", "A"]);
    });

    it("pages every project inline and selects the last result (https://github.com/Brevilabs/obsidian-copilot-private/issues/372)", () => {
      const projects = Array.from({ length: 120 }, (_, index) =>
        makeProject(`Project ${index + 1}`, 120 - index)
      );
      const onSelect = jest.fn();
      render(<ProjectPickerList projects={projects} onSelect={onSelect} app={app} />);
      expect(screen.getAllByText(/^Project \d+$/)).toHaveLength(50);
      expect(screen.queryByText("View all projects")).toBeNull();
      act(() => intersect(true));
      expect(screen.getAllByText(/^Project \d+$/)).toHaveLength(100);
      act(() => intersect(true));
      expect(screen.getAllByText(/^Project \d+$/)).toHaveLength(120);
      fireEvent.click(screen.getByText("Project 120"));
      expect(onSelect).toHaveBeenCalledWith(projects[119]);
    });

    it("searches unloaded names and descriptions and resets paging for each query (https://github.com/Brevilabs/obsidian-copilot-private/issues/372)", () => {
      const projects = Array.from({ length: 120 }, (_, index) =>
        makeProject(`Project ${index + 1}`, 120 - index)
      );
      projects[119].description = "Unique description";
      render(<ProjectPickerList projects={projects} onSelect={noop} app={app} />);
      const search = screen.getByPlaceholderText("Search projects...");
      expect(screen.queryByText("Project 120")).toBeNull();
      fireEvent.change(search, { target: { value: "Project 120" } });
      expect(screen.getByText("Project 120")).toBeTruthy();
      fireEvent.change(search, { target: { value: "UNIQUE DESCRIPTION" } });
      expect(screen.getByText("Project 120")).toBeTruthy();
      fireEvent.change(search, { target: { value: "Project" } });
      expect(screen.getAllByText(/^Project \d+$/)).toHaveLength(50);
      act(() => intersect(true));
      expect(screen.getAllByText(/^Project \d+$/)).toHaveLength(100);
      fireEvent.change(search, { target: { value: "" } });
      expect(screen.getAllByText(/^Project \d+$/)).toHaveLength(50);
      fireEvent.change(search, { target: { value: "Missing" } });
      expect(screen.getByText("No matching projects")).toBeTruthy();
    });

    it("keeps create available in the empty state and selects search results by keyboard (https://github.com/Brevilabs/obsidian-copilot-private/issues/372)", () => {
      const onCreate = jest.fn();
      const onSelect = jest.fn();
      const { rerender } = render(
        <ProjectPickerList projects={[]} onSelect={onSelect} onCreate={onCreate} app={app} />
      );
      expect(screen.getByText("No projects available")).toBeTruthy();
      expect(screen.queryByPlaceholderText("Search projects...")).toBeNull();
      const create = screen.getByRole("button", { name: "New project" });
      fireEvent.click(create);
      expect(onCreate).toHaveBeenCalledWith(create);
      rerender(
        <ProjectPickerList
          projects={[projectA, projectB]}
          onSelect={onSelect}
          onCreate={onCreate}
          app={app}
        />
      );
      fireEvent.change(screen.getByPlaceholderText("Search projects..."), {
        target: { value: "A" },
      });
      const row = screen.getByText("A").closest('[role="button"]')!;
      fireEvent.keyDown(row, { key: "Enter" });
      fireEvent.keyDown(row, { key: " " });
      expect(onSelect).toHaveBeenCalledTimes(2);
      expect(onSelect).toHaveBeenLastCalledWith(projectA);
    });

    it("re-sorts to reflect an in-memory touch ahead of the throttled persist", () => {
      const manager = new RecentUsageManager<string>();
      const { container } = renderPicker(manager);
      expect(renderedOrder(container, names)).toEqual(["C", "B", "A"]);

      act(() => {
        manager.touch("A");
      });

      expect(renderedOrder(container, names)).toEqual(["A", "C", "B"]);
    });

    it("surfaces the inline Reveal / Edit / Delete actions on every row", () => {
      const { getByLabelText } = renderPicker();
      for (const name of names) {
        expect(getByLabelText(`Reveal ${name} in vault`)).toBeTruthy();
        expect(getByLabelText(`Edit project ${name}`)).toBeTruthy();
        expect(getByLabelText(`Delete project ${name}`)).toBeTruthy();
      }
    });
  });
});
