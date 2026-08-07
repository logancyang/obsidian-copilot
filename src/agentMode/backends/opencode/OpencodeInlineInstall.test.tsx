import { OpencodeAbsentInstallActions } from "@/agentMode/backends/opencode/OpencodeInlineInstall";
import {
  AbortError,
  OpencodeNotFoundError,
  OperationInFlightError,
  type RuntimeState,
} from "@/agentMode/backends/opencode/OpencodeBinaryManager";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Notice } from "obsidian";
import React from "react";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const openInstallUI = jest.fn();

/**
 * Stands in for the manager's runtime store. Deliberately a store rather than
 * per-call stubs: the component subscribes to it, so `subscribeRuntimeState`
 * and `getRuntimeState` have to keep stable identities across renders or
 * `useSyncExternalStore` resubscribes every commit and the assertions go green
 * against a component that never really subscribed.
 */
function makeFakeManager() {
  let state: RuntimeState = { kind: "idle" };
  const listeners = new Set<() => void>();
  const install = jest.fn<Promise<{ version: string; path: string }>, []>();
  const adoptExistingBinary = jest.fn<Promise<string>, []>();
  const cancelCurrentOperation = jest.fn();

  return {
    manager: {
      subscribeRuntimeState: (onChange: () => void) => {
        listeners.add(onChange);
        return () => listeners.delete(onChange);
      },
      getRuntimeState: () => state,
      install,
      adoptExistingBinary,
      cancelCurrentOperation,
    },
    install,
    adoptExistingBinary,
    cancelCurrentOperation,
    /** Drive the store the way the real manager's operations would. */
    publish(next: RuntimeState) {
      state = next;
      act(() => listeners.forEach((notify) => notify()));
    },
    listenerCount: () => listeners.size,
  };
}

let fake: ReturnType<typeof makeFakeManager>;

jest.mock("@/agentMode/backends/opencode/descriptor", () => ({
  getOpencodeBinaryManager: () => fake.manager,
  OpencodeBackendDescriptor: { openInstallUI: (...args: unknown[]) => openInstallUI(...args) },
}));

const plugin = {} as CopilotPlugin;

describe("OpencodeInlineInstall", () => {
  describe("OpencodeAbsentInstallActions()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      fake = makeFakeManager();
      fake.install.mockResolvedValue({ version: "1.2.3", path: "/bin/opencode" });
      fake.adoptExistingBinary.mockResolvedValue("/usr/local/bin/opencode");
    });

    it("offers a download and an adopt-existing action while nothing is running", () => {
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      expect(screen.getByRole("button", { name: "Download opencode" })).not.toBeNull();
      expect(screen.getByRole("button", { name: "I already have it" })).not.toBeNull();
    });

    it("replaces the actions with live progress and a cancel control during a download", () => {
      render(<OpencodeAbsentInstallActions plugin={plugin} />);

      fake.publish({
        kind: "installing",
        progress: { phase: "download", received: 512, total: 1024, assetName: "opencode.zip" },
      });

      expect(screen.getByText("Downloading opencode.zip — 512 B / 1.0 KB (50%)")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Cancel" })).not.toBeNull();
      expect(screen.queryByRole("button", { name: "Download opencode" })).toBeNull();
    });

    it("names the version a finished install landed", async () => {
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "Download opencode" }));

      await waitFor(() => expect(Notice).toHaveBeenCalledWith("opencode v1.2.3 installed."));
    });

    it("cancels through the manager rather than a controller of its own", () => {
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fake.publish({ kind: "installing", progress: null });

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(fake.cancelCurrentOperation).toHaveBeenCalled();
    });

    it("surfaces the failure reason and offers a retry when an operation fails", () => {
      render(<OpencodeAbsentInstallActions plugin={plugin} />);

      fake.publish({ kind: "error", message: "GitHub API rate-limited" });

      expect(screen.getByText("GitHub API rate-limited")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Try again" })).not.toBeNull();
    });

    it("runs a fresh install when the user retries after a failure", async () => {
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fake.publish({ kind: "error", message: "network down" });

      fireEvent.click(screen.getByRole("button", { name: "Try again" }));

      await waitFor(() => expect(fake.install).toHaveBeenCalledTimes(1));
    });

    it("adopts a detected binary through the manager's own detect-and-persist", async () => {
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "I already have it" }));

      await waitFor(() => expect(fake.adoptExistingBinary).toHaveBeenCalled());
      await waitFor(() =>
        expect(Notice).toHaveBeenCalledWith("Using the opencode at /usr/local/bin/opencode.")
      );
    });

    // Asserting the rendered controls rather than the Notice copy: an earlier
    // version checked only that the message was raised, so it stayed green
    // while the button that message depends on had vanished from the row.
    it("reveals Configure and retires the adopt action when no opencode is found", async () => {
      fake.adoptExistingBinary.mockImplementation(() => {
        fake.publish({ kind: "error", message: new OpencodeNotFoundError().message });
        return Promise.reject(new OpencodeNotFoundError());
      });
      render(<OpencodeAbsentInstallActions plugin={plugin} />);

      fireEvent.click(screen.getByRole("button", { name: "I already have it" }));

      await waitFor(() => expect(screen.getByRole("button", { name: "Configure" })).not.toBeNull());
      expect(screen.queryByRole("button", { name: "I already have it" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Configure" }));
      expect(openInstallUI).toHaveBeenCalledWith(plugin);
    });

    it("keeps a fruitless detect out of the error log, since the row already carries it", async () => {
      fake.adoptExistingBinary.mockRejectedValue(new OpencodeNotFoundError());
      render(<OpencodeAbsentInstallActions plugin={plugin} />);

      fireEvent.click(screen.getByRole("button", { name: "I already have it" }));

      await waitFor(() => expect(fake.adoptExistingBinary).toHaveBeenCalled());
      expect(logError).not.toHaveBeenCalled();
      expect(Notice).not.toHaveBeenCalled();
    });

    it("keeps a cancelled download out of the error log", async () => {
      fake.install.mockRejectedValue(new AbortError());
      render(<OpencodeAbsentInstallActions plugin={plugin} />);

      fireEvent.click(screen.getByRole("button", { name: "Download opencode" }));

      // Cancelling is the user's own doing, so it is an outcome, not a fault.
      await waitFor(() => expect(fake.install).toHaveBeenCalled());
      expect(logError).not.toHaveBeenCalled();
    });

    it("opens the Configure dialog from the failure state so a custom path stays reachable", () => {
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fake.publish({ kind: "error", message: "nothing found" });

      fireEvent.click(screen.getByRole("button", { name: "Configure" }));

      expect(openInstallUI).toHaveBeenCalledWith(plugin);
    });

    it("blocks a download while a detect is in flight so the two can't both write the path", () => {
      render(<OpencodeAbsentInstallActions plugin={plugin} />);

      fake.publish({ kind: "detecting" });

      const download = screen.getByRole<HTMLButtonElement>("button", {
        name: "Download opencode",
      });
      expect(download.disabled).toBe(true);
      fireEvent.click(download);
      expect(fake.install).not.toHaveBeenCalled();
    });

    // `busy` covers the operations only the Configure dialog can start — upgrade,
    // uninstall, applying a custom path. The row cannot show their progress, but
    // it must not offer either of its own writers underneath them.
    it("hides both binary-path writers while another surface holds the manager", () => {
      render(<OpencodeAbsentInstallActions plugin={plugin} />);

      fake.publish({ kind: "busy" });

      expect(screen.queryByRole("button", { name: "I already have it" })).toBeNull();
      expect(
        screen.getByRole("button", { name: "Download opencode" }).hasAttribute("disabled")
      ).toBe(true);
    });

    it("shows the running operation when the row mounts into one already in flight", () => {
      // The state lives on the manager, so a row that never saw the operation
      // start still renders it — this is what a settings sub-tab switch does.
      fake.publish({ kind: "installing", progress: { phase: "extract", message: "Extracting…" } });

      render(<OpencodeAbsentInstallActions plugin={plugin} />);

      expect(screen.getByText("Extracting…")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Cancel" })).not.toBeNull();
      expect(screen.queryByRole("button", { name: "Download opencode" })).toBeNull();
    });

    it("shows a failure that settled before it mounted", () => {
      fake.publish({ kind: "error", message: "Network unreachable" });

      render(<OpencodeAbsentInstallActions plugin={plugin} />);

      expect(screen.getByText("Network unreachable")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Try again" })).not.toBeNull();
    });

    it("stops listening once unmounted, leaving the operation running", () => {
      const { unmount } = render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fake.publish({ kind: "installing", progress: null });
      expect(fake.listenerCount()).toBe(1);

      unmount();

      // Switching agent sub-tabs unmounts this row; that must drop the
      // subscription without touching the run itself.
      expect(fake.listenerCount()).toBe(0);
      expect(fake.cancelCurrentOperation).not.toHaveBeenCalled();
    });

    it("stays quiet when an action loses the race for the manager", async () => {
      fake.install.mockRejectedValue(new OperationInFlightError());
      render(<OpencodeAbsentInstallActions plugin={plugin} />);

      fireEvent.click(screen.getByRole("button", { name: "Download opencode" }));

      // Another surface got there first; the state it publishes is the report,
      // so this must not raise a second one of its own.
      await waitFor(() => expect(fake.install).toHaveBeenCalled());
      expect(Notice).not.toHaveBeenCalled();
    });
  });
});
