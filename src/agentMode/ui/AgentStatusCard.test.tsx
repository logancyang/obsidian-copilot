import { AgentStatusCard } from "@/agentMode/ui/AgentStatusCard";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("AgentStatusCard", () => {
  describe("AgentStatusCard()", () => {
    it("renders a neutral message and invokes its recovery action", () => {
      const onClick = jest.fn();

      render(
        <AgentStatusCard
          message="Claude not installed"
          action={{ label: "Install Claude", onClick }}
        />
      );

      expect(screen.queryByRole("alert")).toBeNull();
      const action = screen.getByRole("button", { name: "Install Claude" });
      expect(action.className).toContain("tw-bg-secondary");
      fireEvent.click(action);
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("announces warning and error messages with decorative semantic icons", () => {
      const { rerender } = render(
        <AgentStatusCard tone="warning" message="Claude must be upgraded" />
      );

      const warning = screen.getByRole("alert");
      expect(warning.textContent).toBe("Claude must be upgraded");
      expect(warning.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      expect(warning.querySelector("svg")?.getAttribute("class")).toContain("tw-text-warning");
      expect(screen.getByText("Claude must be upgraded").className).toContain("tw-text-normal");

      rerender(<AgentStatusCard tone="error" message="Claude could not start" />);
      const error = screen.getByRole("alert");
      expect(error.textContent).toBe("Claude could not start");
      expect(error.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      expect(error.querySelector("svg")?.getAttribute("class")).toContain("tw-text-error");
      expect(screen.getByText("Claude could not start").className).toContain("tw-text-normal");
    });

    it("keeps a busy action disabled", () => {
      render(
        <AgentStatusCard
          tone="warning"
          message="Claude must be upgraded"
          action={{ label: "Upgrading…", onClick: jest.fn(), disabled: true }}
        />
      );

      expect(screen.getByRole("button", { name: "Upgrading…" }).hasAttribute("disabled")).toBe(
        true
      );
      expect(screen.getByRole("button", { name: "Upgrading…" }).className).toContain(
        "disabled:tw-opacity-100"
      );
    });

    it("renders the sign-in fallback as a safe new-tab link", () => {
      const { rerender } = render(
        <AgentStatusCard
          message="Signing in to Claude…"
          action={{ label: "Open sign-in page", href: "https://example.com/sign-in" }}
        />
      );

      const link = screen.getByRole("link", { name: "Open sign-in page" });
      expect(link.className).toContain("tw-bg-secondary");
      expect(link.getAttribute("href")).toBe("https://example.com/sign-in");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(link.getAttribute("target")).toBe("_blank");

      rerender(
        <AgentStatusCard
          message="Signing in to Claude…"
          action={{ label: "Waiting for sign-in URL", href: "" }}
        />
      );
      expect(
        screen.getByRole("link", { name: "Waiting for sign-in URL" }).getAttribute("href")
      ).toBe("");
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("allows long messages and actions to wrap inside the card", () => {
      const message = "VeryLongBackendNameWithoutNaturalBreaks could not be configured";
      render(
        <AgentStatusCard
          message={message}
          action={{
            label: "Configure VeryLongBackendNameWithoutNaturalBreaks",
            onClick: jest.fn(),
          }}
        />
      );

      expect(screen.getByText(message).className).toContain("tw-break-words");
      expect(screen.getByText(message).className).toContain("tw-min-w-0");
      const action = screen.getByRole("button", {
        name: "Configure VeryLongBackendNameWithoutNaturalBreaks",
      });
      expect(action.className).toContain("tw-max-w-full");
      expect(action.className).toContain("tw-whitespace-normal");
      expect(action.className).toContain("tw-break-words");
    });
  });
});
