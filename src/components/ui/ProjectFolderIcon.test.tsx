import { ProjectFolderIcon } from "@/components/ui/ProjectFolderIcon";
import { render } from "@testing-library/react";
import React from "react";

describe("ProjectFolderIcon", () => {
  describe("ProjectFolderIcon()", () => {
    it("renders a folder icon hidden from assistive technology", () => {
      const { container } = render(<ProjectFolderIcon />);

      expect(container.querySelector(".lucide-folder")?.getAttribute("aria-hidden")).toBe("true");
    });
  });
});
