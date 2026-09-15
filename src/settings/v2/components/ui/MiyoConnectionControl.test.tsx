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
    checking: false,
    onDisconnect: jest.fn(),
    onRetry: jest.fn(),
    ...overrides,
  };
  render(<MiyoConnectionControl {...props} />);
  return props;
}

describe("MiyoConnectionControl", () => {
  describe("MiyoConnectionControl()", () => {
    it("checks and disconnects the selected active connection — https://github.com/Brevilabs/obsidian-copilot-private/issues/466", () => {
      const props = renderControl();
      fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
      fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
      expect(props.onRetry).toHaveBeenCalledTimes(1);
      expect(props.onDisconnect).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("disables connection actions while its check is pending — https://github.com/Brevilabs/obsidian-copilot-private/issues/466", () => {
      const props = renderControl({ checking: true });
      for (const button of screen.getAllByRole<HTMLButtonElement>("button")) {
        expect(button.disabled).toBe(true);
        fireEvent.click(button);
      }
      expect(props.onRetry).not.toHaveBeenCalled();
      expect(props.onDisconnect).not.toHaveBeenCalled();
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
