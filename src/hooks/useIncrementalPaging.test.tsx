import { useIncrementalPaging } from "@/hooks/useIncrementalPaging";
import { act, render, screen } from "@testing-library/react";
import React from "react";

function PagingList({ total = 120, query = "" }: { total?: number; query?: string }) {
  const { displayCount, sentinelRef } = useIncrementalPaging(total, query);
  return (
    <>
      <output>{Math.min(displayCount, total)}</output>
      {displayCount < total && <div ref={sentinelRef} />}
    </>
  );
}

describe("useIncrementalPaging", () => {
  const originalObserver = window.IntersectionObserver;
  let callback: IntersectionObserverCallback;
  const disconnect = jest.fn();
  const observer = { disconnect, observe: jest.fn() } as unknown as IntersectionObserver;
  const intersect = (entries = [{ isIntersecting: true }]) =>
    act(() => callback(entries as IntersectionObserverEntry[], observer));

  beforeEach(() => {
    disconnect.mockClear();
    window.IntersectionObserver = jest.fn((nextCallback: IntersectionObserverCallback) => {
      callback = nextCallback;
      return observer;
    });
  });
  afterEach(() => {
    window.IntersectionObserver = originalObserver;
  });

  describe("useIncrementalPaging()", () => {
    it("bounds pages to 50 and disconnects at the total (https://github.com/Brevilabs/obsidian-copilot-private/issues/372)", () => {
      render(<PagingList />);
      expect(screen.getByRole("status").textContent).toBe("50");
      intersect([{ isIntersecting: false }]);
      intersect([]);
      expect(screen.getByRole("status").textContent).toBe("50");
      intersect();
      expect(screen.getByRole("status").textContent).toBe("100");
      intersect();
      expect(screen.getByRole("status").textContent).toBe("120");
      expect(disconnect).toHaveBeenCalledTimes(1);
    });

    it("resets on a new query even when the total stays the same (https://github.com/Brevilabs/obsidian-copilot-private/issues/372)", () => {
      const { rerender } = render(<PagingList />);
      intersect();
      rerender(<PagingList query="new query" />);
      expect(screen.getByRole("status").textContent).toBe("50");
    });

    it("reconnects for changed totals and disconnects on unmount (https://github.com/Brevilabs/obsidian-copilot-private/issues/372)", () => {
      const { rerender, unmount } = render(<PagingList />);
      rerender(<PagingList total={75} />);
      expect(disconnect).toHaveBeenCalledTimes(1);
      unmount();
      expect(disconnect).toHaveBeenCalledTimes(2);
    });

    it("disconnects when filtering removes the marker (https://github.com/Brevilabs/obsidian-copilot-private/issues/372)", () => {
      const { rerender } = render(<PagingList />);
      rerender(<PagingList total={0} query="no matches" />);
      expect(disconnect).toHaveBeenCalledTimes(1);
    });

    it("uses the owning window observer in a popout (https://github.com/Brevilabs/obsidian-copilot-private/issues/372)", () => {
      const frame = document.createElement("iframe");
      document.body.appendChild(frame);
      const ownerWindow = frame.contentWindow!;
      const container = ownerWindow.document.createElement("div");
      ownerWindow.document.body.appendChild(container);
      const ownerObserver = jest.fn(() => observer);
      Object.defineProperty(ownerWindow, "IntersectionObserver", { value: ownerObserver });
      const { unmount } = render(<PagingList />, { container });
      expect(ownerObserver).toHaveBeenCalledTimes(1);
      expect(window.IntersectionObserver).not.toHaveBeenCalled();
      unmount();
      frame.remove();
    });
  });
});
