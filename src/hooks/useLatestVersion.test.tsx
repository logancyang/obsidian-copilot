import { refreshLatestVersion, useLatestVersion } from "@/hooks/useLatestVersion";
import { checkLatestVersion } from "@/utils";
import { act, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";

jest.mock("@/utils", () => ({
  checkLatestVersion: jest.fn(),
  isNewerVersion: jest.fn(() => true),
}));

const ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/317";
const RELEASE = {
  body: "# Copilot 4.0.4",
  htmlUrl: "https://github.com/logancyang/obsidian-copilot/releases/tag/4.0.4",
  version: "4.0.4",
};

function LatestVersionProbe(): React.ReactElement {
  const value = useLatestVersion("4.0.3");
  return <output>{JSON.stringify(value)}</output>;
}

describe("useLatestVersion", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    refreshLatestVersion();
  });
  describe("useLatestVersion()", () => {
    it(`shares one release payload and request across remounted consumers for ${ISSUE_URL}`, async () => {
      jest.mocked(checkLatestVersion).mockResolvedValue({
        error: null,
        release: RELEASE,
        version: RELEASE.version,
      });

      const firstRender = render(<LatestVersionProbe />);

      await waitFor(() =>
        expect(JSON.parse(screen.getByRole("status").textContent ?? "{}")).toEqual({
          hasUpdate: true,
          latestRelease: RELEASE,
          latestVersion: RELEASE.version,
        })
      );
      firstRender.unmount();

      render(<LatestVersionProbe />);

      await waitFor(() =>
        expect(JSON.parse(screen.getByRole("status").textContent ?? "{}")).toEqual({
          hasUpdate: true,
          latestRelease: RELEASE,
          latestVersion: RELEASE.version,
        })
      );
      expect(checkLatestVersion).toHaveBeenCalledTimes(1);
    });
  });
  describe("refreshLatestVersion()", () => {
    it(`updates mounted consumers after a new-tab refresh for ${ISSUE_URL}`, async () => {
      jest
        .mocked(checkLatestVersion)
        .mockResolvedValue({ error: null, release: RELEASE, version: RELEASE.version });
      const mounted = render(
        <>
          <LatestVersionProbe />
          <LatestVersionProbe />
        </>
      );
      await waitFor(() =>
        expect(screen.getAllByRole("status")[0].textContent).toContain(RELEASE.version)
      );
      expect(checkLatestVersion).toHaveBeenCalledTimes(1);

      const nextRelease = { ...RELEASE, version: "4.0.5", body: "New release notes" };
      jest
        .mocked(checkLatestVersion)
        .mockResolvedValue({ error: null, release: nextRelease, version: nextRelease.version });
      act(() => refreshLatestVersion());

      await waitFor(() => {
        for (const output of screen.getAllByRole("status")) {
          expect(JSON.parse(output.textContent ?? "{}").latestRelease).toEqual(nextRelease);
        }
      });
      expect(checkLatestVersion).toHaveBeenCalledTimes(2);
      mounted.rerender(
        <>
          <LatestVersionProbe />
          <LatestVersionProbe />
        </>
      );
      expect(checkLatestVersion).toHaveBeenCalledTimes(2);
    });
    it(`ignores a stale response after a new-tab refresh for ${ISSUE_URL}`, async () => {
      let resolveOld!: (value: Awaited<ReturnType<typeof checkLatestVersion>>) => void;
      jest.mocked(checkLatestVersion).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve;
        })
      );
      render(<LatestVersionProbe />);
      const nextRelease = { ...RELEASE, version: "4.0.5" };
      jest
        .mocked(checkLatestVersion)
        .mockResolvedValue({ error: null, release: nextRelease, version: nextRelease.version });
      act(() => refreshLatestVersion());
      await waitFor(() => expect(screen.getByRole("status").textContent).toContain("4.0.5"));
      await act(async () => {
        resolveOld({ error: null, release: RELEASE, version: RELEASE.version });
      });
      expect(screen.getByRole("status").textContent).toContain("4.0.5");
    });
  });
});
