import { useTailPaging } from "@/hooks/useTailPaging";
import { act, render, screen } from "@testing-library/react";
import React from "react";

const everyThirdStartsAPage = (index: number) => index % 3 === 0;
const everyItemStartsAPage = () => true;

function TailList({
  total,
  isPageStart = everyItemStartsAPage,
}: {
  total: number;
  isPageStart?: (index: number) => boolean;
}) {
  const { first, sentinelRef } = useTailPaging(total, isPageStart);
  return (
    <>
      <output>{first}</output>
      {first > 0 && <div ref={sentinelRef} data-testid="sentinel" />}
    </>
  );
}

describe("useTailPaging", () => {
  const originalObserver = window.IntersectionObserver;
  let observers: { callback: IntersectionObserverCallback; disconnect: jest.Mock }[];

  const report = (...states: boolean[]) => {
    const latest = observers[observers.length - 1];
    act(() =>
      latest.callback(
        states.map((isIntersecting) => ({ isIntersecting }) as IntersectionObserverEntry),
        {} as unknown as IntersectionObserver
      )
    );
  };
  const scrollMarkerIntoView = (isIntersecting = true) => report(isIntersecting);
  const firstShown = () => Number(screen.getByRole("status").textContent);

  beforeEach(() => {
    observers = [];
    window.IntersectionObserver = jest.fn((callback: IntersectionObserverCallback) => {
      const observer = { callback, disconnect: jest.fn() };
      observers.push(observer);
      return { observe: jest.fn(), disconnect: observer.disconnect };
    }) as unknown as typeof IntersectionObserver;
  });
  afterEach(() => {
    window.IntersectionObserver = originalObserver;
  });

  describe("useTailPaging()", () => {
    it("starts with only the last 10 items of a long list https://github.com/logancyang/obsidian-copilot/issues/4248", () => {
      render(<TailList total={180} />);

      expect(firstShown()).toBe(170);
    });

    it("moves the start back to the nearest page start so a page never begins mid-turn", () => {
      render(<TailList total={30} isPageStart={everyThirdStartsAPage} />);

      expect(firstShown()).toBe(18);
    });

    it("shows every item, with no top marker, when the list has 10 or fewer", () => {
      render(<TailList total={8} />);

      expect(firstShown()).toBe(0);
      expect(screen.queryByTestId("sentinel")).toBeNull();
    });

    it("adds the previous 10 items when the top marker scrolls near view", () => {
      render(<TailList total={180} />);

      scrollMarkerIntoView();

      expect(firstShown()).toBe(160);
    });

    it("acts on the latest report when the browser batches an out-of-view and an in-view report together", () => {
      render(<TailList total={180} />);

      report(false, true);

      expect(firstShown()).toBe(160);
    });

    it("stays put while the top marker is out of view", () => {
      render(<TailList total={180} />);

      scrollMarkerIntoView(false);

      expect(firstShown()).toBe(170);
    });

    it("keeps adding pages while the marker is still in view, so a short page fills the pane", () => {
      render(<TailList total={180} />);

      scrollMarkerIntoView();
      scrollMarkerIntoView();

      expect(observers.length).toBeGreaterThan(1);
      expect(firstShown()).toBe(150);
    });

    it("keeps the start fixed as new items arrive, so a live chat never drops rendered items", () => {
      const { rerender } = render(<TailList total={180} />);

      rerender(<TailList total={260} />);

      expect(firstShown()).toBe(170);
    });

    it("falls back to the last 10 items when the list shrinks past the start", () => {
      const { rerender } = render(<TailList total={180} />);

      rerender(<TailList total={100} />);

      expect(firstShown()).toBe(90);
    });

    it("keeps the items it fell back to when the list grows again after shrinking", () => {
      const { rerender } = render(<TailList total={180} />);
      rerender(<TailList total={100} />);

      rerender(<TailList total={140} />);

      expect(firstShown()).toBe(90);
    });

    it("stops observing once every item is shown", () => {
      render(<TailList total={15} />);

      scrollMarkerIntoView();

      expect(firstShown()).toBe(0);
      expect(observers[0].disconnect).toHaveBeenCalled();
    });
  });
});
