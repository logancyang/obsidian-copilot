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
    it("explains where new and existing Copilot data will remain", () => {
      render(<CopilotFolderChangeNotice {...DEFAULT_PROPS} />);

      expect(screen.getByText("90 System/copilot/", { selector: "code" })).not.toBeNull();
      expect(screen.getByText("copilot/", { selector: "strong" })).not.toBeNull();
      expect(screen.getByText(/stays permanently excluded from Copilot search/)).not.toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("warns that every Markdown file in a non-empty folder will stay excluded", () => {
      render(<CopilotFolderChangeNotice {...DEFAULT_PROPS} containsMarkdown />);

      const warning = screen.getByRole("alert");
      expect(warning.textContent).toContain("This folder already contains Markdown files.");
      expect(warning.textContent).toContain("including regular notes");
      expect(warning.textContent).toContain("excluded from Copilot search");
      expect(warning.textContent).toContain("stays excluded even if you change");
    });
  });
});
