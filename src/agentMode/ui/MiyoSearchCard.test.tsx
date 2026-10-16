import { MiyoSearchCard } from "@/agentMode/ui/MiyoSearchCard";
import { render, screen } from "@testing-library/react";
import React from "react";

const SHIMMER = ".tw-bg-clip-text";

describe("MiyoSearchCard", () => {
  describe("MiyoSearchCard()", () => {
    it("shows the Miyo logo, the query actually sent and the note count for a completed search", () => {
      const { container } = render(
        <MiyoSearchCard status="completed" query="back pain standing desk" noteCount={4} />
      );

      expect(screen.getByText("Searched with Miyo")).toBeTruthy();
      expect(screen.getByText("“back pain standing desk”")).toBeTruthy();
      expect(screen.getByText("4 notes")).toBeTruthy();
      expect(container.querySelector("svg path")).toBeTruthy();
      expect(container.querySelector(SHIMMER)).toBeNull();
    });

    it("uses the singular for one note", () => {
      render(<MiyoSearchCard status="completed" query="q" noteCount={1} />);
      expect(screen.getByText("1 note")).toBeTruthy();
    });

    it("shimmers the label with no count while the search is running", () => {
      const { container } = render(
        <MiyoSearchCard status="in_progress" query="tariff code" noteCount={null} />
      );

      expect(container.querySelector(SHIMMER)?.textContent).toBe("Searching with Miyo");
      expect(screen.getByText("“tariff code”")).toBeTruthy();
      expect(screen.queryByText(/note/)).toBeNull();
    });

    it("turns the shimmer off for reduced motion by gating the animation and restoring plain text", () => {
      const { container } = render(<MiyoSearchCard status="pending" query="q" noteCount={null} />);
      const label = container.querySelector(SHIMMER)!;

      expect(label.className).toContain("motion-safe:tw-animate-");
      expect(label.className).toContain("motion-reduce:tw-bg-none");
      expect(label.className).toContain("motion-reduce:tw-text-normal");
    });

    it("says No notes when Miyo returned nothing", () => {
      render(<MiyoSearchCard status="completed" query="offsite agenda" noteCount={0} />);
      expect(screen.getByText("No notes")).toBeTruthy();
    });

    it("shows the error state without a shimmer or count when the search failed", () => {
      const { container } = render(
        <MiyoSearchCard status="failed" query="desk" noteCount={null} />
      );

      expect(screen.getByText("Miyo search failed").className).toContain("tw-text-error");
      expect(container.querySelector(SHIMMER)).toBeNull();
      expect(container.querySelector(".tw-animate-pulse")).toBeNull();
    });

    it("omits the count when the backend gave no parsable output", () => {
      render(<MiyoSearchCard status="completed" query="desk" noteCount={null} />);

      expect(screen.getByText("Searched with Miyo")).toBeTruthy();
      expect(screen.queryByText(/note/)).toBeNull();
    });

    it("omits the query text when the command carried none", () => {
      render(<MiyoSearchCard status="completed" query={null} noteCount={2} />);
      expect(screen.queryByText(/“/)).toBeNull();
    });
  });
});
