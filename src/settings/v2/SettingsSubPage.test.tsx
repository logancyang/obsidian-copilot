import { TabProvider, useTab } from "@/contexts/TabContext";
import { SettingsSubPageHost, useSettingsSubPage } from "@/settings/v2/SettingsSubPage";
import { act, fireEvent, render, screen } from "@testing-library/react";
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

interface SettingsWithOpenerProps {
  onMount?: () => void;
  onUnmount?: () => void;
}

const SettingsWithOpener: React.FC<SettingsWithOpenerProps> = ({ onMount, onUnmount }) => {
  const { open } = useSettingsSubPage();
  const { selectedTab } = useTab();
  const [count, setCount] = React.useState(0);
  React.useEffect(() => {
    onMount?.();
    return onUnmount;
  }, [onMount, onUnmount]);
  return (
    <div>
      <h1>Copilot settings</h1>
      <p>Selected tab: {selectedTab}</p>
      <button type="button" onClick={() => setCount((n) => n + 1)}>
        Clicked {count} times
      </button>
      <button type="button" onClick={() => open(<SubPage />)}>
        Open sub-page
      </button>
    </div>
  );
};

let selectTab: (tab: "basic" | "advanced") => void = () => undefined;

const TabSelector: React.FC = () => {
  selectTab = useTab().setSelectedTab;
  return null;
};

function renderInScroller(props: SettingsWithOpenerProps = {}) {
  const view = render(
    <TabProvider>
      <TabSelector />
      <div data-testid="scroller" style={{ overflowY: "auto" }}>
        <SettingsSubPageHost>
          <SettingsWithOpener {...props} />
        </SettingsSubPageHost>
      </div>
    </TabProvider>
  );
  return { ...view, scroller: screen.getByTestId("scroller") };
}

describe("SettingsSubPage", () => {
  describe("SettingsSubPageHost()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/874 replaces everything it wraps with an opened sub-page, and closing it shows the settings again with their state intact", () => {
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

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/874 keeps the settings mounted while a sub-page shows, so work running in them, such as a connector login, is not cancelled by opening or closing the page", () => {
      const onMount = jest.fn();
      const onUnmount = jest.fn();
      renderInScroller({ onMount, onUnmount });

      fireEvent.click(screen.getByRole("button", { name: "Open sub-page" }));
      fireEvent.click(screen.getByRole("button", { name: "Back" }));

      expect(onMount).toHaveBeenCalledTimes(1);
      expect(onUnmount).not.toHaveBeenCalled();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/874 opens the sub-page at the top of the scrolling settings, and closing it returns to the earlier scroll position with focus on the control that opened it", () => {
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

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/874 closes the sub-page when another settings tab is selected, showing that tab without remounting the settings", () => {
      const onUnmount = jest.fn();
      renderInScroller({ onUnmount });
      fireEvent.click(screen.getByRole("button", { name: "Clicked 0 times" }));
      fireEvent.click(screen.getByRole("button", { name: "Open sub-page" }));

      act(() => selectTab("advanced"));

      expect(screen.queryByText("Sub-page content")).toBeNull();
      expect(screen.getByText("Selected tab: advanced")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Clicked 1 times" })).not.toBeNull();
      expect(onUnmount).not.toHaveBeenCalled();
    });
  });

  describe("useSettingsSubPage()", () => {
    it("throws when used outside a SettingsSubPageHost, so a section cannot silently fail to open its page", () => {
      const reactErrorLog = jest.spyOn(console, "error").mockImplementation(() => {});

      expect(() =>
        render(
          <TabProvider>
            <SettingsWithOpener />
          </TabProvider>
        )
      ).toThrow("useSettingsSubPage must be used inside SettingsSubPageHost");
      reactErrorLog.mockRestore();
    });
  });
});
