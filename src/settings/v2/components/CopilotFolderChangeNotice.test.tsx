import {
  CopilotFolderChangeNotice,
  type CopilotFolderChangeNoticeProps,
} from "@/settings/v2/components/CopilotFolderChangeNotice";
import { render, screen } from "@testing-library/react";
import React from "react";

const DEFAULT_PROPS: CopilotFolderChangeNoticeProps = {
  oldRoot: "copilot",
  newRoot: "90 System/copilot",
  containsMarkdown: false,
};

describe("CopilotFolderChangeNotice", () => {
  describe("CopilotFolderChangeNotice()", () => {
    it("labels both paths and separates retained data from permanent exclusion (https://github.com/Brevilabs/obsidian-copilot-private/issues/409)", () => {
      render(<CopilotFolderChangeNotice {...DEFAULT_PROPS} />);

      expect(screen.getByText("90 System/copilot/", { selector: "code" })).not.toBeNull();
      expect(screen.getByText("copilot/", { selector: "code" })).not.toBeNull();
      expect(
        screen.getByText("New Copilot folder", { selector: "dt" }).nextElementSibling?.textContent
      ).toContain("90 System/copilot/");
      expect(
        screen.getByText("Existing data", { selector: "dt" }).nextElementSibling?.textContent
      ).toContain("copilot/");
      expect(screen.getByText("Files are not moved automatically.")).not.toBeNull();
      expect(screen.getByText(/stays permanently excluded from Copilot search/)).not.toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("leads with permanent Markdown exclusion before the path details (https://github.com/Brevilabs/obsidian-copilot-private/issues/409)", () => {
      render(<CopilotFolderChangeNotice {...DEFAULT_PROPS} containsMarkdown />);

      const warning = screen.getByRole("alert");
      expect(warning.textContent).toMatch(
        /^Markdown files in this folder will be excluded from Copilot search\./
      );
      expect(
        warning.compareDocumentPosition(screen.getByText("New Copilot folder")) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(warning.textContent).toContain("includes regular notes");
      expect(warning.textContent).toContain("excluded from Copilot search");
      expect(warning.textContent).toContain("even if you change the Copilot folder later");
    });
  });
});
