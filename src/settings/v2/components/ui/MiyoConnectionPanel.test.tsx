import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { MiyoConnectionPanel, type MiyoConnectionPanelProps } from "./MiyoConnectionPanel";

const ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/466";
const ISSUE_471 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/471";

function renderPanel(overrides: Partial<MiyoConnectionPanelProps> = {}) {
  const props: MiyoConnectionPanelProps = {
    mode: "local",
    activeMode: "local",
    enabled: true,
    status: "available",
    checking: false,
    address: "",
    downloadUrl: "https://www.miyo.md/",
    onModeChange: jest.fn(),
    onAddressChange: jest.fn(),
    children: <button type="button">Connect</button>,
    ...overrides,
  };
  render(<MiyoConnectionPanel {...props} />);
  return props;
}

describe("MiyoConnectionPanel", () => {
  describe("MiyoConnectionPanel()", () => {
    it(`attaches Connected to the active local title while browsing remote (${ISSUE_URL})`, () => {
      renderPanel({ mode: "remote" });
      expect(screen.getByRole("status").textContent).toBe("Connected");
      expect(screen.getByRole("status").closest("label")?.textContent).toContain("Local");
      expect(screen.getByRole<HTMLInputElement>("radio", { name: /Remote server/ }).checked).toBe(
        true
      );
      expect(screen.getByLabelText("Server address")).toBeTruthy();
    });

    it(`keeps a stale remote connection on its title while browsing local (${ISSUE_URL})`, () => {
      const props = renderPanel({ activeMode: "remote", status: "stale" });
      expect(screen.getByRole("status").textContent).toBe("Connected");
      expect(screen.getByRole("status").closest("label")?.textContent).toContain("Remote server");
      fireEvent.click(screen.getByRole("radio", { name: /Remote server/ }));
      expect(props.onModeChange).toHaveBeenCalledWith("remote");
      expect(screen.getByRole("link", { name: "Download" }).getAttribute("href")).toBe(
        "https://www.miyo.md/"
      );
    });

    it.each([
      { enabled: false, status: "available" as const },
      { enabled: true, status: "unavailable" as const },
      { enabled: true, status: "unknown" as const },
    ])(`shows Offline for an inactive or unreachable endpoint %j (${ISSUE_URL})`, (state) => {
      renderPanel(state);
      expect(screen.getByRole("status").textContent).toBe("Offline");
      expect(screen.queryByText("Connected")).toBeNull();
    });

    it(`shows Checking instead of cached connectivity during a health check (${ISSUE_URL})`, () => {
      renderPanel({ checking: true });
      expect(screen.getByRole("status").textContent).toBe("Checking…");
      expect(screen.queryByText("Connected")).toBeNull();
    });

    it(`disables the local option and drops its badge where no local Miyo can be reached (${ISSUE_471})`, () => {
      renderPanel({ mode: "remote", activeMode: "local", localSupported: false });
      const local = screen.getByRole<HTMLInputElement>("radio", { name: /^Local/ });
      expect(local.disabled).toBe(true);
      expect(
        screen.getByText("Needs Miyo running on this device. Use Remote server instead.")
      ).toBeTruthy();
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.queryByRole("link", { name: "Download" })).toBeNull();
    });

    it(`reports address edits without persisting or changing the active badge (${ISSUE_URL})`, () => {
      const props = renderPanel({
        mode: "remote",
        address: "http://home:8742",
        error: "Enter a valid address.",
      });
      fireEvent.change(screen.getByLabelText("Server address"), {
        target: { value: "http://work:8742" },
      });
      expect(props.onAddressChange).toHaveBeenCalledWith("http://work:8742");
      expect(screen.getByRole("status").closest("label")?.textContent).toContain("Local");
      expect(screen.getByRole("alert").textContent).toBe("Enter a valid address.");
    });
  });
});
