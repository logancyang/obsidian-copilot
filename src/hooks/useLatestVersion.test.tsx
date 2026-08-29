import { useLatestVersion } from "@/hooks/useLatestVersion";
import { checkLatestVersion } from "@/utils";
import { render, screen, waitFor } from "@testing-library/react";
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
});
