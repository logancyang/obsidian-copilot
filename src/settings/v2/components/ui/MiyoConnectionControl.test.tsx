import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import {
  MiyoAvailabilityNotice,
  MiyoConnectionControl,
  type MiyoConnectionControlProps,
} from "./MiyoConnectionControl";

const ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/356";

function renderControl(overrides: Partial<MiyoConnectionControlProps> = {}) {
  const props: MiyoConnectionControlProps = {
    enabled: true,
    status: "available",
    checking: false,
    remote: false,
    onConnect: jest.fn(),
    onDisconnect: jest.fn(),
    onRetry: jest.fn(),
    ...overrides,
  };
  render(<MiyoConnectionControl {...props} />);
  return props;
}

describe("MiyoConnectionControl", () => {
  describe("MiyoConnectionControl()", () => {
    it(`shows Connect and reports the action when Miyo was never enabled (${ISSUE_URL})`, () => {
      const props = renderControl({ enabled: false, status: "unknown" });

      fireEvent.click(screen.getByRole("button", { name: "Connect" }));

      expect(props.onConnect).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("status")).toBeNull();
    });

    it(`shows checking instead of a cached connected state while a probe is running (${ISSUE_URL})`, () => {
      const props = renderControl({ checking: true, status: "available" });

      expect(screen.getByRole("status").textContent).toContain("Checking…");
      expect(screen.queryByText(/Connected/)).toBeNull();
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
      expect(props.onRetry).not.toHaveBeenCalled();
    });

    it(`shows a healthy local connection and lets the user disconnect (${ISSUE_URL})`, () => {
      const props = renderControl();

      fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

      expect(screen.getByRole("status").textContent).toContain("Connected · local");
      expect(props.onDisconnect).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    });

    it(`keeps a stale remote snapshot visibly connected (${ISSUE_URL})`, () => {
      renderControl({ status: "stale", remote: true });

      expect(screen.getByRole("status").textContent).toContain("Connected · remote");
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    });

    it(`offers Retry beside Disconnect when enabled Miyo is unavailable (${ISSUE_URL})`, () => {
      const props = renderControl({ status: "unavailable" });

      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

      expect(screen.getByRole("status").textContent).toContain("Unavailable");
      expect(props.onRetry).toHaveBeenCalledTimes(1);
      expect(props.onDisconnect).toHaveBeenCalledTimes(1);
      expect(props.onConnect).not.toHaveBeenCalled();
    });
  });

  describe("MiyoAvailabilityNotice()", () => {
    it(`distinguishes an unavailable enabled endpoint from a disconnected one (${ISSUE_URL})`, () => {
      const { rerender } = render(
        <MiyoAvailabilityNotice enabled={true} available={false} checking={false} />
      );

      expect(screen.getByText(/Miyo is unavailable/)).toBeTruthy();

      rerender(<MiyoAvailabilityNotice enabled={false} available={false} checking={false} />);
      expect(screen.getByText(/Connect to Miyo/)).toBeTruthy();
    });

    it(`shows no unavailable guidance while checking or connected (${ISSUE_URL})`, () => {
      const { rerender } = render(
        <MiyoAvailabilityNotice enabled={true} available={false} checking={true} />
      );

      expect(screen.queryByText(/Miyo is unavailable/)).toBeNull();

      rerender(<MiyoAvailabilityNotice enabled={true} available={true} checking={false} />);
      expect(screen.queryByText(/Miyo is unavailable/)).toBeNull();
    });
  });
});
