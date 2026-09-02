import { useReducedMotion } from "@/hooks/useReducedMotion";
import { act, renderHook } from "@testing-library/react";

interface MatchMediaController {
  mediaQuery: MediaQueryList;
  setMatches: (matches: boolean) => void;
}

function installMatchMedia(initialMatches: boolean): MatchMediaController {
  let matches = initialMatches;
  const listeners = new Set<EventListener>();
  const mediaQuery = {
    get matches() {
      return matches;
    },
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: jest.fn((_type: string, listener: EventListener) => {
      listeners.add(listener);
    }),
    removeEventListener: jest.fn((_type: string, listener: EventListener) => {
      listeners.delete(listener);
    }),
  } as unknown as MediaQueryList;

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: jest.fn(() => mediaQuery),
  });

  return {
    mediaQuery,
    setMatches(nextMatches: boolean) {
      matches = nextMatches;
      const event = { matches: nextMatches, media: mediaQuery.media } as MediaQueryListEvent;
      act(() => listeners.forEach((listener) => listener(event)));
    },
  };
}

describe("useReducedMotion", () => {
  describe("useReducedMotion()", () => {
    afterEach(() => {
      Reflect.deleteProperty(window, "matchMedia");
    });

    it("tracks preference changes and cleans up its listener for https://github.com/logancyang/obsidian-copilot/issues/3078", () => {
      const controller = installMatchMedia(false);
      const { result, unmount } = renderHook(() => useReducedMotion());

      expect(result.current).toBe(false);

      controller.setMatches(true);
      expect(result.current).toBe(true);

      unmount();
      expect(controller.mediaQuery.removeEventListener).toHaveBeenCalledWith(
        "change",
        expect.any(Function)
      );
    });
  });
});
