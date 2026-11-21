import { NEUTRAL_FACE_SRC } from "@/agents/customAgentFiles";
import { logWarn } from "@/logger";
import { PRESET_FACES_URL } from "@/agents/presetFaces";
import { webpBytes } from "@/agents/testing/webpBytes";
import {
  dismissFirstAgentBanner,
  FirstAgentBanner,
  useFirstAgentBannerVisible,
} from "@/agents/ui/FirstAgentBanner";
import { getSettings, resetSettings, sanitizeSettings, setSettings } from "@/settings/model";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import * as obsidian from "obsidian";
import React from "react";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/939";

const setRequestUrlImpl = (
  obsidian as unknown as { __setRequestUrlImpl: (impl: jest.Mock) => void }
).__setRequestUrlImpl;

const FACE_NAMES = ["coco", "maya", "leo", "nora"];
const faceUrl = (name: string) => `https://images.brevilabs.com/agent-faces/${name}.webp`;

function dataUri(bytes: ArrayBuffer): string {
  return `data:image/webp;base64,${btoa(String.fromCharCode(...new Uint8Array(bytes)))}`;
}

function serveFaces(names = FACE_NAMES): jest.Mock {
  const request = jest.fn(async ({ url }: { url: string }) =>
    url === PRESET_FACES_URL
      ? { json: { faces: names.map((id) => ({ id, alt: id, url: faceUrl(id) })) } }
      : { arrayBuffer: webpBytes(FACE_NAMES.indexOf(url.slice(url.lastIndexOf("/") + 1, -5))) }
  );
  setRequestUrlImpl(request);
  return request;
}

function bannerFaceSrcs(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("img"), (img) => img.getAttribute("src") ?? "");
}

const PLACEHOLDERS = [NEUTRAL_FACE_SRC, NEUTRAL_FACE_SRC, NEUTRAL_FACE_SRC];
const FIRST_THREE = [webpBytes(0), webpBytes(1), webpBytes(2)].map(dataUri);

describe("FirstAgentBanner", () => {
  beforeEach(() => {
    resetSettings();
    serveFaces();
  });

  describe("FirstAgentBanner()", () => {
    it("explains teammates and opens the create dialog from Create your first teammate", () => {
      const onCreate = jest.fn();
      render(<FirstAgentBanner onCreate={onCreate} onDismiss={jest.fn()} />);

      expect(screen.getByText("Give each job its own teammate")).not.toBeNull();
      expect(
        screen.getByText("A teammate has its own instructions and remembers the rules you give it.")
      ).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Create your first teammate" }));

      expect(onCreate).toHaveBeenCalledTimes(1);
    });

    it(`shows the first three faces of the preset face list once they load (${ISSUE})`, async () => {
      const request = serveFaces();
      const { container } = render(<FirstAgentBanner onCreate={jest.fn()} onDismiss={jest.fn()} />);

      await waitFor(() => expect(bannerFaceSrcs(container)).toEqual(FIRST_THREE));
      expect(request.mock.calls.map(([options]: [{ url: string }]) => options.url)).toEqual([
        PRESET_FACES_URL,
        faceUrl("coco"),
        faceUrl("maya"),
        faceUrl("leo"),
      ]);
      expect(container.querySelector("[aria-hidden='true']")?.querySelectorAll("img")).toHaveLength(
        3
      );
    });

    it(`shows three grey placeholder faces while the preset faces load (${ISSUE})`, () => {
      setRequestUrlImpl(jest.fn(() => new Promise(() => {})));

      const { container } = render(<FirstAgentBanner onCreate={jest.fn()} onDismiss={jest.fn()} />);

      expect(bannerFaceSrcs(container)).toEqual(PLACEHOLDERS);
    });

    it(`fills the faces the list has and leaves the other places grey when it lists fewer than three (${ISSUE})`, async () => {
      serveFaces(["coco"]);

      const { container } = render(<FirstAgentBanner onCreate={jest.fn()} onDismiss={jest.fn()} />);

      await waitFor(() =>
        expect(bannerFaceSrcs(container)).toEqual([
          FIRST_THREE[0],
          NEUTRAL_FACE_SRC,
          NEUTRAL_FACE_SRC,
        ])
      );
    });

    it(`keeps the grey placeholder faces when the preset face list cannot load, as when offline (${ISSUE})`, async () => {
      jest.mocked(logWarn).mockClear();
      setRequestUrlImpl(jest.fn().mockRejectedValue(new Error("net::ERR_INTERNET_DISCONNECTED")));

      const { container } = render(<FirstAgentBanner onCreate={jest.fn()} onDismiss={jest.fn()} />);

      await waitFor(() =>
        expect(logWarn).toHaveBeenCalledWith(
          "[Custom agents] Could not load the first-agent banner's faces",
          expect.any(Error)
        )
      );
      expect(bannerFaceSrcs(container)).toEqual(PLACEHOLDERS);
    });

    it("dismisses itself from its close button", () => {
      const onDismiss = jest.fn();
      render(<FirstAgentBanner onCreate={jest.fn()} onDismiss={onDismiss} />);

      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe("useFirstAgentBannerVisible()", () => {
    it("shows the banner while there are no agents and hides it once one exists", () => {
      const { result, rerender } = renderHook(({ count }) => useFirstAgentBannerVisible(count), {
        initialProps: { count: 0 },
      });
      expect(result.current).toBe(true);

      rerender({ count: 1 });

      expect(result.current).toBe(false);
    });

    it(`keeps the banner away after the first agent is deleted again (${ISSUE})`, () => {
      const { result, rerender } = renderHook(({ count }) => useFirstAgentBannerVisible(count), {
        initialProps: { count: 1 },
      });

      rerender({ count: 0 });

      expect(result.current).toBe(false);
      expect(getSettings().agentMode.firstTeammateBannerDismissed).toBe(true);
    });

    it(`hides the banner for good once it is dismissed, even after the settings are loaded again (${ISSUE})`, () => {
      const { result } = renderHook(() => useFirstAgentBannerVisible(0));

      act(() => dismissFirstAgentBanner());
      expect(result.current).toBe(false);

      act(() => setSettings(sanitizeSettings(getSettings())));
      expect(result.current).toBe(false);
      expect(getSettings().agentMode.firstTeammateBannerDismissed).toBe(true);
    });
  });

  describe("dismissFirstAgentBanner()", () => {
    it("records the dismissal in the settings", () => {
      dismissFirstAgentBanner();

      expect(getSettings().agentMode.firstTeammateBannerDismissed).toBe(true);
    });
  });
});
