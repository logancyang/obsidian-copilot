import { FilterChip } from "@/components/ui/filter-chip";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("FilterChip", () => {
  it("uses an icon and theme accent tokens so pressed state does not depend on color alone", () => {
    const { rerender } = render(
      <FilterChip pressed count={12} onClick={() => undefined}>
        epub
      </FilterChip>
    );
    const chip = screen.getByRole("button", { name: "epub 12" });

    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(chip.className).toContain("tw-bg-interactive-accent");
    expect(chip.className).toContain("tw-text-on-accent");
    expect(chip.querySelector("svg")).toBeTruthy();

    rerender(
      <FilterChip pressed={false} count={12} onClick={() => undefined}>
        epub
      </FilterChip>
    );

    expect(chip.getAttribute("aria-pressed")).toBe("false");
    expect(chip.className).toContain("tw-bg-transparent");
    expect(chip.querySelector("svg")).toBeNull();
  });
});
