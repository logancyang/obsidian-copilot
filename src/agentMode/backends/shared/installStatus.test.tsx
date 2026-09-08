import type { InstallState } from "@/agentMode/session/types";
import { render, screen } from "@testing-library/react";
import React from "react";
import { ConfigStatusBadge, InstallBadge, installBadge } from "./installStatus";

describe("installStatus", () => {
  describe("installBadge()", () => {
    it.each([
      [{ signedIn: false }, "Sign in required"],
      [null, "Checking sign-in…"],
      [{ signedIn: true }, "Ready"],
    ] as const)(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/379 derives installed agent readiness from authentication %j",
      (authStatus, label) => {
        expect(installBadge({ kind: "ready", source: "managed" }, authStatus)?.label).toBe(label);
      }
    );
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 preserves binary errors while authentication is unavailable", () => {
      expect(installBadge({ kind: "error", message: "Invalid CLI" }, null)?.label).toBe("Error");
    });
    it("returns a green 'Ready' badge with a check for ready state", () => {
      const spec = installBadge({ kind: "ready", source: "managed" });
      expect(spec).toEqual({
        label: "Ready",
        variant: "success",
        showCheck: true,
      });
    });

    it("ignores source — custom and managed both read 'Ready' (no path/source on the card)", () => {
      expect(installBadge({ kind: "ready", source: "custom" })?.label).toBe("Ready");
      expect(installBadge({ kind: "ready", source: "managed" })?.label).toBe("Ready");
    });

    it("returns null for absent state — the missing badge is the 'not configured' signal", () => {
      expect(installBadge({ kind: "absent" })).toBeNull();
    });

    it("returns a destructive 'Error' badge carrying the message as a tooltip", () => {
      const state: InstallState = { kind: "error", message: "boom" };
      expect(installBadge(state)).toEqual({
        label: "Error",
        variant: "destructive",
        title: "boom",
      });
    });

    it("returns a shared incompatible-version badge with the requirement as a tooltip", () => {
      const state: InstallState = {
        kind: "incompatible",
        source: "custom",
        currentVersion: "2.1.205",
        minVersion: "2.1.206",
        message: "Claude Code 2.1.205 is not supported.",
      };
      expect(installBadge(state)).toEqual({
        label: "Incompatible version",
        variant: "destructive",
        title: state.message,
      });
    });

    it("returns a neutral checking badge while compatibility is being probed", () => {
      expect(installBadge({ kind: "checking", source: "managed" })).toEqual({
        label: "Checking…",
        variant: "outline",
      });
    });
  });

  describe("InstallBadge()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 renders sign-in readiness without changing binary readiness", () => {
      render(
        <InstallBadge
          state={{ kind: "ready", source: "custom" }}
          authStatus={{ signedIn: false }}
        />
      );
      expect(screen.getByText("Sign in required")).toBeTruthy();
      expect(screen.queryByText("Ready")).toBeNull();
    });
  });
  describe("ConfigStatusBadge()", () => {
    it.each([
      [{ signedIn: false }, "Sign in required"],
      [null, "Checking sign-in…"],
      [{ signedIn: true }, "Ready"],
    ] as const)(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/379 uses the same account readiness in Configure for %j",
      (authStatus, label) => {
        render(
          <ConfigStatusBadge state={{ kind: "ready", source: "custom" }} authStatus={authStatus} />
        );
        expect(screen.getByText(label)).toBeTruthy();
      }
    );
    it.each<[InstallState["kind"], string, InstallState]>([
      ["ready", "Ready", { kind: "ready", source: "managed" }],
      ["absent", "Not set up", { kind: "absent" }],
      [
        "incompatible",
        "Upgrade required",
        {
          kind: "incompatible",
          source: "custom",
          currentVersion: "2.1.205",
          minVersion: "2.1.206",
          message: "Claude 2.1.205 is not supported.",
        },
      ],
      ["checking", "Checking…", { kind: "checking", source: "managed" }],
      ["error", "Error", { kind: "error", message: "boom" }],
    ])("labels a %s install '%s'", (_kind, label, state) => {
      render(<ConfigStatusBadge state={state} />);
      expect(screen.getByText(label)).toBeTruthy();
    });

    it("names 'Not set up' where the settings card stays silent, so a dialog never looks blank", () => {
      render(<ConfigStatusBadge state={{ kind: "absent" }} />);
      expect(screen.getByText("Not set up")).toBeTruthy();
      expect(installBadge({ kind: "absent" })).toBeNull();
    });
  });
});
