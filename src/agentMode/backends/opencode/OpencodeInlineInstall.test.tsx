import {
  OpencodeAbsentInstallActions,
  __resetInFlightInstallForTests,
} from "@/agentMode/backends/opencode/OpencodeInlineInstall";
import type CopilotPlugin from "@/main";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Notice } from "obsidian";
import React from "react";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const install = jest.fn();
const setCustomBinaryPath = jest.fn();
const detectOpencodeCliPath = jest.fn();
const openInstallUI = jest.fn();

jest.mock("@/agentMode/backends/opencode/descriptor", () => ({
  getOpencodeBinaryManager: () => ({
    install: (...args: unknown[]) => install(...args),
    setCustomBinaryPath: (...args: unknown[]) => setCustomBinaryPath(...args),
  }),
  detectOpencodeCliPath: () => detectOpencodeCliPath(),
  OpencodeBackendDescriptor: { openInstallUI: (...args: unknown[]) => openInstallUI(...args) },
}));

const plugin = {} as CopilotPlugin;

/** A pending install whose progress/settlement the test drives by hand. */
function deferredInstall() {
  let resolve!: (value: { version: string; path: string }) => void;
  let reject!: (reason: unknown) => void;
  let onProgress: ((e: unknown) => void) | undefined;
  let signal: AbortSignal | undefined;
  install.mockImplementation(
    (opts: { onProgress?: (e: unknown) => void; signal?: AbortSignal }) => {
      onProgress = opts.onProgress;
      signal = opts.signal;
      return new Promise<{ version: string; path: string }>((res, rej) => {
        resolve = res;
        reject = rej;
        // The manager rejects with an AbortError once the caller aborts.
        opts.signal?.addEventListener("abort", () => {
          const err = new Error("Aborted");
          err.name = "AbortError";
          rej(err);
        });
      });
    }
  );
  return {
    resolve,
    get reject() {
      return reject;
    },
    get onProgress() {
      return onProgress;
    },
    get signal() {
      return signal;
    },
    settle: (value: { version: string; path: string }) => resolve(value),
    fail: (reason: unknown) => reject(reason),
  };
}

describe("OpencodeInlineInstall", () => {
  describe("OpencodeAbsentInstallActions()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      // The install is module-scoped so it can outlive a remount; without this
      // a test that leaves one pending would block the next test's download.
      __resetInFlightInstallForTests();
      install.mockResolvedValue({ version: "1.2.3", path: "/bin/opencode" });
      setCustomBinaryPath.mockResolvedValue(undefined);
      detectOpencodeCliPath.mockResolvedValue("/usr/local/bin/opencode");
    });

    it("offers a download and an adopt-existing action while nothing is running", () => {
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      expect(screen.getByRole("button", { name: "Download opencode" })).not.toBeNull();
      expect(screen.getByRole("button", { name: "I already have it" })).not.toBeNull();
    });

    it("replaces the actions with live progress and a cancel control during a download", async () => {
      const pending = deferredInstall();
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "Download opencode" }));

      await screen.findByRole("button", { name: "Cancel" });
      expect(screen.queryByRole("button", { name: "Download opencode" })).toBeNull();

      act(() => {
        pending.onProgress?.({
          phase: "download",
          received: 512,
          total: 1024,
          assetName: "opencode.zip",
        });
      });
      expect(screen.getByText("Downloading opencode.zip — 512 B / 1.0 KB (50%)")).not.toBeNull();
    });

    it("carries a first install through to completion and names the version it landed", async () => {
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "Download opencode" }));

      await waitFor(() => expect(Notice).toHaveBeenCalledWith("opencode v1.2.3 installed."));
      expect(install).toHaveBeenCalledWith(
        expect.objectContaining({ signal: expect.anything(), onProgress: expect.any(Function) })
      );
      // A finished install leaves neither a download in flight nor a failure to
      // retry; the row itself goes away when the panel flips to ready.
      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    });

    it("aborts the install and returns to the idle actions when the user cancels", async () => {
      const pending = deferredInstall();
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "Download opencode" }));

      fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

      expect(pending.signal?.aborted).toBe(true);
      await screen.findByRole("button", { name: "Download opencode" });
      // A cancellation is not a failure, so no error is surfaced.
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    });

    it("surfaces the failure reason and offers a retry when the install pipeline throws", async () => {
      install.mockRejectedValue(new Error("GitHub API rate-limited"));
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "Download opencode" }));

      expect(await screen.findByText("GitHub API rate-limited")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Try again" })).not.toBeNull();
    });

    it("runs a fresh install when the user retries after a failure", async () => {
      install.mockRejectedValueOnce(new Error("network down"));
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "Download opencode" }));

      fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

      await waitFor(() => expect(install).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.queryByText("network down")).toBeNull());
    });

    it("adopts a detected binary by persisting it through the manager's validation", async () => {
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "I already have it" }));

      await waitFor(() =>
        expect(setCustomBinaryPath).toHaveBeenCalledWith("/usr/local/bin/opencode")
      );
    });

    it("points the user at Configure when no opencode is found on the device", async () => {
      detectOpencodeCliPath.mockResolvedValue(null);
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "I already have it" }));

      expect(await screen.findByText(/Couldn't find opencode on this device/)).not.toBeNull();
      expect(setCustomBinaryPath).not.toHaveBeenCalled();
    });

    it("opens the Configure dialog from the failure state so a custom path stays reachable", async () => {
      detectOpencodeCliPath.mockResolvedValue(null);
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "I already have it" }));

      fireEvent.click(await screen.findByRole("button", { name: "Configure" }));
      expect(openInstallUI).toHaveBeenCalledWith(plugin);
    });

    it("blocks a download while a detect is in flight so the two can't both write the binary path", async () => {
      let finishDetect!: (path: string | null) => void;
      detectOpencodeCliPath.mockReturnValue(
        new Promise<string | null>((resolve) => {
          finishDetect = resolve;
        })
      );
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "I already have it" }));

      const download = await screen.findByRole<HTMLButtonElement>("button", {
        name: "Download opencode",
      });
      expect(download.disabled).toBe(true);
      fireEvent.click(download);
      expect(install).not.toHaveBeenCalled();

      await act(async () => {
        finishDetect(null);
      });
    });

    it.each([
      ["the detected path is no longer a file", "No file at /usr/local/bin/opencode"],
      [
        "the binary is not executable",
        "/usr/local/bin/opencode is not executable. chmod +x and try again.",
      ],
      [
        "the version probe reports nothing usable",
        "/usr/local/bin/opencode --version output didn't include a version number. Is this an opencode binary?",
      ],
    ])("reports the manager's reason when %s", async (_case, message) => {
      setCustomBinaryPath.mockRejectedValue(new Error(message));
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "I already have it" }));

      expect(await screen.findByText(message)).not.toBeNull();
    });

    it("leaves an in-flight install running and stops updating state once unmounted", async () => {
      const pending = deferredInstall();
      const { unmount } = render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "Download opencode" }));
      await screen.findByRole("button", { name: "Cancel" });

      const emitProgress = pending.onProgress;
      unmount();

      // Switching agent sub-tabs unmounts this row, so unmounting must not
      // cancel a download the user never cancelled.
      expect(pending.signal?.aborted).toBe(false);
      // A late progress callback must not reach setState on an unmounted tree;
      // React would warn, and jest.setup promotes console noise into failures.
      expect(() =>
        emitProgress?.({ phase: "extract", message: "Extracting archive…" })
      ).not.toThrow();
    });

    it("shows the running install again when the row remounts, rather than an idle button", async () => {
      const pending = deferredInstall();
      const { unmount } = render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "Download opencode" }));
      await screen.findByRole("button", { name: "Cancel" });
      act(() => pending.onProgress?.({ phase: "extract", message: "Extracting archive…" }));
      unmount();

      // Coming back to the tab must pick the install up where it is.
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      expect(screen.getByRole("button", { name: "Cancel" })).not.toBeNull();
      expect(screen.getByText("Extracting archive…")).not.toBeNull();
      expect(screen.queryByRole("button", { name: "Download opencode" })).toBeNull();
    });

    it("hides both binary-path writers while a managed install is still running", async () => {
      deferredInstall();
      const { unmount } = render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "Download opencode" }));
      await screen.findByRole("button", { name: "Cancel" });
      unmount();

      // Adopting and installing both persist the binary path, so a remounted
      // row must offer neither: whichever settled last would win, leaving
      // settings naming a source the user did not choose last.
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      expect(screen.queryByRole("button", { name: "I already have it" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Download opencode" })).toBeNull();
      expect(setCustomBinaryPath).not.toHaveBeenCalled();
      expect(install).toHaveBeenCalledTimes(1);
    });

    // Every install outcome has to reach whichever row is on screen, not just
    // the one that started it. A row that mounts mid-download and never hears
    // the end would sit on a progress bar whose Cancel points at nothing.
    // Adopt is the other writer of the binary path, so it belongs to the same
    // shared lifecycle as the managed install — a remounted row must not offer
    // Download on top of a detect that is still about to persist a path.
    it("keeps a detect visible across a remount instead of offering Download", async () => {
      let resolveDetect: (path: string | null) => void = () => {};
      detectOpencodeCliPath.mockImplementation(
        () =>
          new Promise<string | null>((resolve) => {
            resolveDetect = resolve;
          })
      );
      const { unmount } = render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "I already have it" }));
      await screen.findByRole("button", { name: "Looking…" });
      unmount();

      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      expect(screen.getByRole("button", { name: "Looking…" })).not.toBeNull();
      expect(
        screen.getByRole("button", { name: "Download opencode" }).hasAttribute("disabled")
      ).toBe(true);

      await act(async () => {
        resolveDetect("/usr/local/bin/opencode");
      });
      await waitFor(() =>
        expect(setCustomBinaryPath).toHaveBeenCalledWith("/usr/local/bin/opencode")
      );
      expect(install).not.toHaveBeenCalled();
    });

    it("surfaces a failed detect on a remounted row", async () => {
      let resolveDetect: (path: string | null) => void = () => {};
      detectOpencodeCliPath.mockImplementation(
        () =>
          new Promise<string | null>((resolve) => {
            resolveDetect = resolve;
          })
      );
      const { unmount } = render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "I already have it" }));
      await screen.findByRole("button", { name: "Looking…" });
      unmount();
      render(<OpencodeAbsentInstallActions plugin={plugin} />);

      await act(async () => {
        resolveDetect(null);
      });

      expect(await screen.findByText(/Couldn't find opencode on this device/)).not.toBeNull();
    });

    // A failure published to zero rows is silent, while both success paths
    // already announce unconditionally. These cover the asymmetry.
    it("announces an install failure that lands while no row is mounted", async () => {
      const pending = deferredInstall();
      const { unmount } = render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "Download opencode" }));
      await screen.findByRole("button", { name: "Cancel" });
      unmount();

      await act(async () => {
        pending.fail(new Error("GitHub API rate-limited"));
      });

      expect(Notice).toHaveBeenCalledWith("opencode setup failed: GitHub API rate-limited");
    });

    it("announces a failed detect that lands while no row is mounted", async () => {
      let resolveDetect: (path: string | null) => void = () => {};
      detectOpencodeCliPath.mockImplementation(
        () =>
          new Promise<string | null>((resolve) => {
            resolveDetect = resolve;
          })
      );
      const { unmount } = render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "I already have it" }));
      await screen.findByRole("button", { name: "Looking…" });
      unmount();

      await act(async () => {
        resolveDetect(null);
      });

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("Couldn't find opencode on this device")
      );
    });

    it("returns a remounted row to the idle actions when the install succeeds", async () => {
      const pending = deferredInstall();
      const { unmount } = render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "Download opencode" }));
      await screen.findByRole("button", { name: "Cancel" });
      unmount();
      render(<OpencodeAbsentInstallActions plugin={plugin} />);

      await act(async () => {
        pending.settle({ version: "1.2.3", path: "/bin/opencode" });
      });

      expect(await screen.findByRole("button", { name: "Download opencode" })).not.toBeNull();
      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    });

    it("shows the failure on a remounted row when the install throws", async () => {
      const pending = deferredInstall();
      const { unmount } = render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "Download opencode" }));
      await screen.findByRole("button", { name: "Cancel" });
      unmount();
      render(<OpencodeAbsentInstallActions plugin={plugin} />);

      await act(async () => {
        pending.fail(new Error("Network unreachable"));
      });

      expect(await screen.findByText("Network unreachable")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Try again" })).not.toBeNull();
    });

    it("returns a remounted row to idle when the install is cancelled from it", async () => {
      const pending = deferredInstall();
      const { unmount } = render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "Download opencode" }));
      await screen.findByRole("button", { name: "Cancel" });
      unmount();
      render(<OpencodeAbsentInstallActions plugin={plugin} />);

      // The remounted row's Cancel must reach the live controller, not the
      // dead one from the mount that started the download.
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      });

      expect(pending.signal?.aborted).toBe(true);
      expect(await screen.findByRole("button", { name: "Download opencode" })).not.toBeNull();
    });
  });
});
