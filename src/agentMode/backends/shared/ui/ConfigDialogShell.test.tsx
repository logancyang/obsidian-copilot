import type { InstallState } from "@/agentMode/session/types";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ConfigDialogShell, ConfigSection, ConfigWarningStrip } from "./ConfigDialogShell";

const OUTDATED: InstallState = {
  kind: "incompatible",
  source: "custom",
  currentVersion: "2.1.205",
  minVersion: "2.1.206",
  message: "Claude 2.1.205 is not supported.",
};

describe("ConfigDialogShell", () => {
  describe("ConfigDialogShell()", () => {
    it("renders the dialog title as a heading beside the status badge", () => {
      render(
        <ConfigDialogShell title="Configure Claude" state={{ kind: "absent" }} onClose={jest.fn()}>
          <p>body</p>
        </ConfigDialogShell>
      );

      const heading = screen.getByRole("heading", { name: "Configure Claude" });
      expect(heading.parentElement?.textContent).toBe("Configure ClaudeNot set up");
    });

    it("does not reserve a warning band when a supplied strip has no message", () => {
      const ready = { kind: "ready", source: "custom" } as const;
      const { container } = render(
        <ConfigDialogShell
          title="Configure Claude"
          state={ready}
          warning={<ConfigWarningStrip state={ready} />}
          onClose={jest.fn()}
        >
          <p>body</p>
        </ConfigDialogShell>
      );

      expect(container.firstElementChild?.children).toHaveLength(3);
    });

    it("renders the supplied warning between the header and the body", () => {
      render(
        <ConfigDialogShell
          title="Configure Claude"
          state={OUTDATED}
          warning={<ConfigWarningStrip state={OUTDATED} />}
          onClose={jest.fn()}
        >
          <p>body</p>
        </ConfigDialogShell>
      );

      const alert = screen.getByRole("alert");
      expect(alert.textContent).toBe("Claude 2.1.205 is not supported.");
      expect(
        alert.compareDocumentPosition(screen.getByText("body")) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    it("closes the dialog from the default Done button", () => {
      const onClose = jest.fn();
      render(
        <ConfigDialogShell title="Configure opencode" state={{ kind: "absent" }} onClose={onClose}>
          <p>body</p>
        </ConfigDialogShell>
      );

      fireEvent.click(screen.getByRole("button", { name: "Done" }));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("replaces the Done button with a supplied footer", () => {
      render(
        <ConfigDialogShell
          title="Configure opencode"
          state={{ kind: "absent" }}
          footer={<button type="button">Save</button>}
          onClose={jest.fn()}
        >
          <p>body</p>
        </ConfigDialogShell>
      );

      expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    });
  });

  describe("ConfigSection()", () => {
    it("places account status beside the section heading: https://github.com/Brevilabs/obsidian-copilot-private/issues/379", () => {
      render(
        <ConfigSection title="Authentication" badge={<span>Signed in</span>}>
          <p>Account controls</p>
        </ConfigSection>
      );
      expect(
        screen.getByRole("heading", { name: "Authentication" }).parentElement?.textContent
      ).toBe("AuthenticationSigned in");
      expect(screen.getByText("Account controls")).toBeTruthy();
    });

    it("drops the section heading when no title is given", () => {
      render(
        <ConfigSection>
          <p>body</p>
        </ConfigSection>
      );

      expect(screen.queryByRole("heading")).toBeNull();
      expect(screen.getByText("body")).toBeTruthy();
    });
  });

  describe("ConfigWarningStrip()", () => {
    it("announces the install state's message as an alert", () => {
      render(<ConfigWarningStrip state={OUTDATED} />);

      const alert = screen.getByRole("alert");
      expect(alert.textContent).toBe("Claude 2.1.205 is not supported.");
      expect(alert.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    });

    it("appends the caller's remedy sentence after the message", () => {
      render(<ConfigWarningStrip state={OUTDATED} detail="Reopen this dialog afterwards." />);

      expect(screen.getByRole("alert").textContent).toBe(
        "Claude 2.1.205 is not supported. Reopen this dialog afterwards."
      );
    });

    it("renders an in-dialog action only when one is given", () => {
      const { rerender } = render(<ConfigWarningStrip state={OUTDATED} />);
      expect(screen.queryByRole("button")).toBeNull();

      rerender(
        <ConfigWarningStrip state={OUTDATED} action={<button type="button">Upgrade</button>} />
      );
      expect(screen.getByRole("button", { name: "Upgrade" })).toBeTruthy();
    });

    it("renders nothing for states that carry no message", () => {
      const { container, rerender } = render(<ConfigWarningStrip state={{ kind: "absent" }} />);
      expect(container.innerHTML).toBe("");

      rerender(<ConfigWarningStrip state={{ kind: "ready", source: "managed" }} />);
      expect(container.innerHTML).toBe("");
    });
  });
});
