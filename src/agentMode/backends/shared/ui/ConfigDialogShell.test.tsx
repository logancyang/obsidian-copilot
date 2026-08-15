import type { InstallState } from "@/agentMode/session/types";
import { render, screen } from "@testing-library/react";
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

    it("omits the warning region entirely when no warning is supplied", () => {
      render(
        <ConfigDialogShell
          title="Configure Claude"
          state={{ kind: "ready", source: "custom" }}
          onClose={jest.fn()}
        >
          <p>body</p>
        </ConfigDialogShell>
      );

      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText("Ready")).toBeTruthy();
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

    it("keeps every band a full-width sibling that pads itself", () => {
      const { container } = render(
        <ConfigDialogShell
          title="Configure opencode"
          state={{ kind: "absent" }}
          onClose={jest.fn()}
        >
          <ConfigSection title="Download managed binary">
            <p>body</p>
          </ConfigSection>
        </ConfigDialogShell>
      );

      // Padding on the container instead of the bands would inset every
      // divider, leaving a gap at both ends of each hairline. The host modal's
      // own padding is stripped by CONFIG_MODAL_CLASS, which the host passes as
      // ReactModal's modalClass.
      const shell = container.firstElementChild as HTMLElement;
      expect(shell.className).not.toMatch(/tw-p[xl]?-/);
      const footer = shell.lastElementChild as HTMLElement;
      expect(footer.className).toContain("copilot-divider-t");
      expect(footer.className).toContain("tw-bg-secondary");
      expect(footer.textContent).toBe("Done");
    });
  });

  describe("ConfigSection()", () => {
    it("renders its body in a self-padded band under a hairline divider", () => {
      const { container } = render(
        <ConfigSection title="Use your own binary">
          <p>body</p>
        </ConfigSection>
      );

      const band = container.firstElementChild as HTMLElement;
      expect(band.className).toContain("copilot-divider-t");
      expect(band.className).toContain("tw-p-4");
      expect(band.textContent).toBe("Use your own binarybody");
    });

    it("drops the section heading when no title is given", () => {
      const { container } = render(
        <ConfigSection>
          <p>body</p>
        </ConfigSection>
      );

      expect(container.firstElementChild?.children.length).toBe(1);
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
