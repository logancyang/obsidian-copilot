import { ProjectFolderIcon } from "@/components/ui/ProjectFolderIcon";
import { render } from "@testing-library/react";
import React from "react";

describe("ProjectFolderIcon", () => {
  describe("ProjectFolderIcon()", () => {
    it("renders a decorative neutral folder without project palette classes", () => {
      const { container } = render(<ProjectFolderIcon />);
      const folder = container.querySelector(".lucide-folder");
      expect(folder?.getAttribute("aria-hidden")).toBe("true");
      expect(folder?.classList.contains("tw-text-muted")).toBe(true);
      expect(folder?.getAttribute("class")).not.toMatch(/tw-(?:bg|text)-project-/);
    });

    it("composes caller sizing classes with the neutral treatment", () => {
      const { container } = render(<ProjectFolderIcon className="tw-size-5" />);
      const folder = container.querySelector(".lucide-folder");
      expect(folder?.classList.contains("tw-size-5")).toBe(true);
      expect(folder?.classList.contains("tw-text-muted")).toBe(true);
    });
  });
});
