// Mock the Manage modal so its transitive Obsidian-subclass imports
// (FuzzySuggestModal via the row Edit action's AddProjectModal) don't crash
// module load under the obsidian mock.
jest.mock("@/components/modals/project/context-manage-modal", () => ({
  ContextManageModal: jest.fn().mockImplementation(() => ({ open: jest.fn() })),
}));

import { ProjectConfig } from "@/aiParams";
import { ProjectPickerList } from "@/agentMode/ui/ProjectPickerList";
import { RecentUsageManager } from "@/utils/recentUsageManager";
import { act, render } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";

// jsdom lacks Obsidian's `activeDocument`; the View-all popover portals into it.
// The tests below keep to the inline list (≤ INLINE_LIMIT projects) and never
// open that surface, but alias defensively.
beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
});

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

/** Project-name order as rendered, top-to-bottom (ignores icon-only action buttons). */
function renderedOrder(container: HTMLElement, names: string[]): string[] {
  const rows = Array.from(container.querySelectorAll<HTMLElement>('[role="button"]'));
  return rows
    .map((row) => names.find((name) => row.textContent?.includes(name)))
    .filter((name): name is string => Boolean(name));
}

describe("ProjectPickerList", () => {
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

  it("renders projects in most-recently-used order from persisted timestamps", () => {
    const { container } = renderPicker();
    expect(renderedOrder(container, names)).toEqual(["C", "B", "A"]);
  });

  it("falls back to persisted order when no usage manager is provided", () => {
    const { container } = renderPicker(undefined);
    // No crash, and the persisted MRU order still holds.
    expect(renderedOrder(container, names)).toEqual(["C", "B", "A"]);
  });

  it("re-sorts to reflect an in-memory touch ahead of the throttled persist", () => {
    const manager = new RecentUsageManager<string>();
    const { container } = renderPicker(manager);
    expect(renderedOrder(container, names)).toEqual(["C", "B", "A"]);

    // Touch the oldest project in memory only (no persist). The revision
    // subscription should re-sort it to the top even though its persisted
    // UsageTimestamps is still the oldest.
    act(() => {
      manager.touch("A");
    });

    expect(renderedOrder(container, names)).toEqual(["A", "C", "B"]);
  });

  it("surfaces the inline Reveal / Edit / Delete actions on every row", () => {
    const { getByLabelText } = renderPicker();
    // The actions render inline per row (revealed on hover via CSS) instead of
    // behind a single overflow trigger — getByLabelText throws if any is missing,
    // so resolving all three per project is the assertion.
    for (const name of names) {
      expect(getByLabelText(`Reveal ${name} in vault`)).toBeTruthy();
      expect(getByLabelText(`Edit project ${name}`)).toBeTruthy();
      expect(getByLabelText(`Delete project ${name}`)).toBeTruthy();
    }
  });
});
