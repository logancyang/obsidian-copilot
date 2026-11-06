import { SettingsSubPageHost, useSettingsSubPage } from "@/settings/v2/SettingsSubPage";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const SubPage: React.FC = () => {
  const { close } = useSettingsSubPage();
  return (
    <div>
      <button type="button" onClick={close}>
        Back
      </button>
      <p>Sub-page content</p>
    </div>
  );
};

const SettingsWithOpener: React.FC = () => {
  const { open } = useSettingsSubPage();
  const [count, setCount] = React.useState(0);
  return (
    <div>
      <h1>Copilot settings</h1>
      <button type="button" onClick={() => setCount((n) => n + 1)}>
        Clicked {count} times
      </button>
      <button type="button" onClick={() => open(<SubPage />)}>
        Open sub-page
      </button>
    </div>
  );
};

function renderInScroller() {
  const view = render(
    <div data-testid="scroller" style={{ overflowY: "auto" }}>
      <SettingsSubPageHost>
        <SettingsWithOpener />
      </SettingsSubPageHost>
    </div>
  );
  return { ...view, scroller: screen.getByTestId("scroller") };
}

describe("SettingsSubPage", () => {
  describe("SettingsSubPageHost()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/865 replaces everything it wraps with an opened sub-page, and closing it shows the settings again with their state intact", () => {
      renderInScroller();
      fireEvent.click(screen.getByRole("button", { name: "Clicked 0 times" }));

      fireEvent.click(screen.getByRole("button", { name: "Open sub-page" }));

      expect(screen.getByText("Sub-page content")).not.toBeNull();
      expect(screen.queryByRole("heading", { name: "Copilot settings" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Open sub-page" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Back" }));

      expect(screen.queryByText("Sub-page content")).toBeNull();
      expect(screen.getByRole("heading", { name: "Copilot settings" })).not.toBeNull();
      expect(screen.getByRole("button", { name: "Clicked 1 times" })).not.toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/865 opens the sub-page at the top of the scrolling settings, and closing it returns to the earlier scroll position with focus on the control that opened it", () => {
      const { scroller } = renderInScroller();
      const opener = screen.getByRole("button", { name: "Open sub-page" });
      scroller.scrollTop = 640;
      opener.focus();

      fireEvent.click(opener);

      expect(scroller.scrollTop).toBe(0);

      fireEvent.click(screen.getByRole("button", { name: "Back" }));

      expect(scroller.scrollTop).toBe(640);
      expect(document.activeElement).toBe(opener);
    });
  });

  describe("useSettingsSubPage()", () => {
    it("throws when used outside a SettingsSubPageHost, so a section cannot silently fail to open its page", () => {
      const reactErrorLog = jest.spyOn(console, "error").mockImplementation(() => {});

      expect(() => render(<SettingsWithOpener />)).toThrow(
        "useSettingsSubPage must be used inside SettingsSubPageHost"
      );
      reactErrorLog.mockRestore();
    });
  });
});
