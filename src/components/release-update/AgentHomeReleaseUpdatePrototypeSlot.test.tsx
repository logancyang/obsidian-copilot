import { AgentHomeReleaseUpdatePrototypeSlot } from "@/components/release-update/AgentHomeReleaseUpdatePrototypeSlot";
import { setAgentHomeReleaseUpdatePrototype } from "@/components/release-update/agentHomeReleaseUpdatePrototypeStore";
import { AppContext } from "@/context";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { App } from "obsidian";
import * as React from "react";

const mockOpenReleaseNotes = jest.fn();
jest.mock("@/components/release-update/ReleaseNotesDialog", () => ({
  ReleaseNotesModal: jest.fn().mockImplementation(() => ({ open: mockOpenReleaseNotes })),
}));

const ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/317";

function renderSlot(visible = true) {
  return render(
    <AppContext.Provider value={new App()}>
      <AgentHomeReleaseUpdatePrototypeSlot visible={visible} />
    </AppContext.Provider>
  );
}

describe("AgentHomeReleaseUpdatePrototypeSlot", () => {
  beforeEach(() => {
    setAgentHomeReleaseUpdatePrototype(false);
    mockOpenReleaseNotes.mockClear();
  });

  describe("AgentHomeReleaseUpdatePrototypeSlot()", () => {
    it("renders nothing when no development prototype is selected", () => {
      renderSlot();

      expect(screen.queryByRole("status")).toBeNull();
    });

    it(`shows the selected prototype only on the global empty home for ${ISSUE_URL}`, () => {
      setAgentHomeReleaseUpdatePrototype(true);
      const { rerender } = renderSlot(false);

      expect(screen.queryByRole("status")).toBeNull();
      rerender(
        <AppContext.Provider value={new App()}>
          <AgentHomeReleaseUpdatePrototypeSlot visible />
        </AppContext.Provider>
      );
      expect(screen.getByRole("status").getAttribute("data-agent-home-release-update")).toBe(
        "bottom-banner"
      );
    });

    it("updates a mounted home when the development command shows the preview", () => {
      renderSlot();

      act(() => setAgentHomeReleaseUpdatePrototype(true));

      expect(screen.getByRole("status").getAttribute("data-agent-home-release-update")).toBe(
        "bottom-banner"
      );
    });

    it("clears the selected prototype when dismissed", () => {
      setAgentHomeReleaseUpdatePrototype(true);
      renderSlot();

      fireEvent.click(screen.getByRole("button", { name: "Dismiss release update" }));

      expect(screen.queryByRole("status")).toBeNull();
    });

    it(`opens the release-notes dialog from the selected bottom banner for ${ISSUE_URL}`, () => {
      setAgentHomeReleaseUpdatePrototype(true);
      renderSlot();

      fireEvent.click(screen.getByRole("button", { name: "See what’s new" }));

      expect(mockOpenReleaseNotes).toHaveBeenCalledTimes(1);
    });
  });
});
