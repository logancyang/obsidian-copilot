import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { AtMentionTypeahead } from "./AtMentionTypeahead";

Element.prototype.scrollIntoView = jest.fn();

jest.mock("./hooks/useAtMentionCategories", () => ({
  useAtMentionCategories: jest.fn(() => [
    { key: "notes", title: "Notes", subtitle: "Reference notes", category: "notes" },
  ]),
  CATEGORY_OPTIONS: [
    { key: "notes", title: "Notes", subtitle: "Reference notes", category: "notes" },
  ],
}));

jest.mock("./hooks/useAtMentionSearch", () => ({
  useAtMentionSearch: jest.fn(),
}));

jest.mock("obsidian", () => ({
  TFile: class {},
  Platform: { isDesktopApp: true },
}));

import { useAtMentionSearch } from "./hooks/useAtMentionSearch";

const mockUseAtMentionSearch = useAtMentionSearch as jest.Mock;

type MockOption = { key: string; title: string; data: string; disabled?: boolean };

function mockSearchResults(options: MockOption[]) {
  mockUseAtMentionSearch.mockReturnValue(
    options.map((option) => ({ ...option, category: "notes" }))
  );
}

describe("AtMentionTypeahead", () => {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    onSelect: jest.fn(),
    currentActiveFile: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("AtMentionTypeahead()", () => {
    it("renders nothing when it is closed", () => {
      mockSearchResults([]);

      const { container } = render(<AtMentionTypeahead {...defaultProps} isOpen={false} />);

      expect(container.firstChild).toBeNull();
    });

    it("selects the highlighted option and closes on Enter", () => {
      mockSearchResults([{ key: "1", title: "Enabled Option", data: "file1" }]);

      render(<AtMentionTypeahead {...defaultProps} />);
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

      expect(defaultProps.onSelect).toHaveBeenCalledWith("notes", "file1");
      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it("closes without selecting on Escape", () => {
      mockSearchResults([{ key: "1", title: "Option", data: "file1" }]);

      render(<AtMentionTypeahead {...defaultProps} />);
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });

      expect(defaultProps.onClose).toHaveBeenCalled();
      expect(defaultProps.onSelect).not.toHaveBeenCalled();
    });

    it("skips a disabled option when navigating down", () => {
      mockSearchResults([
        { key: "1", title: "Option 1", data: "file1" },
        { key: "2", title: "Option 2 (disabled)", data: "file2", disabled: true },
        { key: "3", title: "Option 3", data: "file3" },
      ]);

      render(<AtMentionTypeahead {...defaultProps} />);
      const searchInput = screen.getByRole("textbox");
      fireEvent.keyDown(searchInput, { key: "ArrowDown" });
      fireEvent.keyDown(searchInput, { key: "Enter" });

      expect(defaultProps.onSelect).toHaveBeenCalledWith("notes", "file3");
    });

    it("skips a disabled option when navigating up", () => {
      mockSearchResults([
        { key: "1", title: "Option 1", data: "file1" },
        { key: "2", title: "Option 2 (disabled)", data: "file2", disabled: true },
        { key: "3", title: "Option 3", data: "file3" },
      ]);

      render(<AtMentionTypeahead {...defaultProps} />);
      const searchInput = screen.getByRole("textbox");
      fireEvent.keyDown(searchInput, { key: "ArrowDown" });
      fireEvent.keyDown(searchInput, { key: "ArrowUp" });
      fireEvent.keyDown(searchInput, { key: "Enter" });

      expect(defaultProps.onSelect).toHaveBeenCalledWith("notes", "file1");
    });

    it("keeps the highlight in place when only disabled options follow", () => {
      mockSearchResults([
        { key: "1", title: "Option 1", data: "file1" },
        { key: "2", title: "Disabled 1", data: "file2", disabled: true },
        { key: "3", title: "Disabled 2", data: "file3", disabled: true },
      ]);

      render(<AtMentionTypeahead {...defaultProps} />);
      const searchInput = screen.getByRole("textbox");
      fireEvent.keyDown(searchInput, { key: "ArrowDown" });
      fireEvent.keyDown(searchInput, { key: "Enter" });

      expect(defaultProps.onSelect).toHaveBeenCalledWith("notes", "file1");
    });

    it("keeps the highlight in place when only disabled options precede it", () => {
      mockSearchResults([
        { key: "1", title: "Disabled 1", data: "file1", disabled: true },
        { key: "2", title: "Disabled 2", data: "file2", disabled: true },
        { key: "3", title: "Option 3", data: "file3" },
      ]);

      render(<AtMentionTypeahead {...defaultProps} />);
      const searchInput = screen.getByRole("textbox");
      fireEvent.keyDown(searchInput, { key: "ArrowDown" });
      fireEvent.keyDown(searchInput, { key: "ArrowUp" });
      fireEvent.keyDown(searchInput, { key: "Enter" });

      expect(defaultProps.onSelect).toHaveBeenCalledWith("notes", "file3");
    });

    it.each(["Enter", "Tab"])("does not select a disabled option on %s", (key) => {
      mockSearchResults([{ key: "1", title: "Disabled Option", data: "file1", disabled: true }]);

      render(<AtMentionTypeahead {...defaultProps} />);
      fireEvent.keyDown(screen.getByRole("textbox"), { key });

      expect(defaultProps.onSelect).not.toHaveBeenCalled();
    });
  });
});
