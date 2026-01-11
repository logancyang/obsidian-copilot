/**
 * RTL tests for AtMentionTypeahead component
 *
 * Tests keyboard navigation skipping disabled options and preventing selection of disabled items.
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { AtMentionTypeahead } from "./AtMentionTypeahead";

// Mock scrollIntoView for jsdom
Element.prototype.scrollIntoView = jest.fn();

// Mock hooks
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

// Import after mocking
import { useAtMentionSearch } from "./hooks/useAtMentionSearch";

const mockUseAtMentionSearch = useAtMentionSearch as jest.Mock;

describe("AtMentionTypeahead", () => {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    onSelect: jest.fn(),
    isCopilotPlus: false,
    currentActiveFile: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Disabled Option Handling", () => {
    it("should skip disabled options when pressing ArrowDown", () => {
      // Setup: 3 options where middle one is disabled
      mockUseAtMentionSearch.mockReturnValue([
        { key: "1", title: "Option 1", category: "notes", data: "file1", disabled: false },
        { key: "2", title: "Option 2 (disabled)", category: "notes", data: "file2", disabled: true },
        { key: "3", title: "Option 3", category: "notes", data: "file3", disabled: false },
      ]);

      render(<AtMentionTypeahead {...defaultProps} />);

      // Get the search input (which handles keyboard events)
      const searchInput = screen.getByRole("textbox");

      // Press ArrowDown from first option (index 0)
      // Should skip disabled option at index 1 and land on index 2
      fireEvent.keyDown(searchInput, { key: "ArrowDown" });

      // The component should have moved to Option 3, skipping Option 2
      // We verify by pressing Enter and checking what gets selected
      fireEvent.keyDown(searchInput, { key: "Enter" });

      expect(defaultProps.onSelect).toHaveBeenCalledWith("notes", "file3");
    });

    it("should skip disabled options when pressing ArrowUp", () => {
      mockUseAtMentionSearch.mockReturnValue([
        { key: "1", title: "Option 1", category: "notes", data: "file1", disabled: false },
        { key: "2", title: "Option 2 (disabled)", category: "notes", data: "file2", disabled: true },
        { key: "3", title: "Option 3", category: "notes", data: "file3", disabled: false },
      ]);

      render(<AtMentionTypeahead {...defaultProps} />);

      const searchInput = screen.getByRole("textbox");

      // Navigate to last option first
      fireEvent.keyDown(searchInput, { key: "ArrowDown" }); // skips to 2 (last valid)

      // Now press ArrowUp - should skip disabled and go to first
      fireEvent.keyDown(searchInput, { key: "ArrowUp" });
      fireEvent.keyDown(searchInput, { key: "Enter" });

      expect(defaultProps.onSelect).toHaveBeenCalledWith("notes", "file1");
    });

    it("should not select disabled option when pressing Enter", () => {
      // All options disabled except none - test Enter on disabled
      mockUseAtMentionSearch.mockReturnValue([
        { key: "1", title: "Disabled Option", category: "notes", data: "file1", disabled: true },
      ]);

      render(<AtMentionTypeahead {...defaultProps} />);

      const searchInput = screen.getByRole("textbox");

      // Try to select the disabled option
      fireEvent.keyDown(searchInput, { key: "Enter" });

      // onSelect should NOT have been called
      expect(defaultProps.onSelect).not.toHaveBeenCalled();
    });

    it("should not select disabled option when pressing Tab", () => {
      mockUseAtMentionSearch.mockReturnValue([
        { key: "1", title: "Disabled Option", category: "notes", data: "file1", disabled: true },
      ]);

      render(<AtMentionTypeahead {...defaultProps} />);

      const searchInput = screen.getByRole("textbox");

      // Try to select with Tab
      fireEvent.keyDown(searchInput, { key: "Tab" });

      expect(defaultProps.onSelect).not.toHaveBeenCalled();
    });

    it("should stay at current position if no valid option found when navigating down", () => {
      mockUseAtMentionSearch.mockReturnValue([
        { key: "1", title: "Option 1", category: "notes", data: "file1", disabled: false },
        { key: "2", title: "Disabled 1", category: "notes", data: "file2", disabled: true },
        { key: "3", title: "Disabled 2", category: "notes", data: "file3", disabled: true },
      ]);

      render(<AtMentionTypeahead {...defaultProps} />);

      const searchInput = screen.getByRole("textbox");

      // Press ArrowDown - no valid options after index 0, should stay at 0
      fireEvent.keyDown(searchInput, { key: "ArrowDown" });
      fireEvent.keyDown(searchInput, { key: "Enter" });

      // Should still select Option 1 since it couldn't move
      expect(defaultProps.onSelect).toHaveBeenCalledWith("notes", "file1");
    });

    it("should stay at current position if no valid option found when navigating up", () => {
      mockUseAtMentionSearch.mockReturnValue([
        { key: "1", title: "Disabled 1", category: "notes", data: "file1", disabled: true },
        { key: "2", title: "Disabled 2", category: "notes", data: "file2", disabled: true },
        { key: "3", title: "Option 3", category: "notes", data: "file3", disabled: false },
      ]);

      render(<AtMentionTypeahead {...defaultProps} />);

      const searchInput = screen.getByRole("textbox");

      // Navigate to last valid option
      fireEvent.keyDown(searchInput, { key: "ArrowDown" });
      fireEvent.keyDown(searchInput, { key: "ArrowDown" });

      // Press ArrowUp - no valid options before, should stay at current
      fireEvent.keyDown(searchInput, { key: "ArrowUp" });
      fireEvent.keyDown(searchInput, { key: "Enter" });

      expect(defaultProps.onSelect).toHaveBeenCalledWith("notes", "file3");
    });

    it("should not call onSelect for disabled option via handleSelect (defensive)", () => {
      // This tests the guard we added in handleSelect
      mockUseAtMentionSearch.mockReturnValue([
        { key: "1", title: "Disabled", category: "notes", data: "file1", disabled: true },
        { key: "2", title: "Enabled", category: "notes", data: "file2", disabled: false },
      ]);

      render(<AtMentionTypeahead {...defaultProps} />);

      // Even if somehow a disabled option got through to handleSelect,
      // the guard should prevent selection
      // We test this by verifying keyboard Enter doesn't select disabled
      const searchInput = screen.getByRole("textbox");
      fireEvent.keyDown(searchInput, { key: "Enter" });

      expect(defaultProps.onSelect).not.toHaveBeenCalled();
    });
  });

  describe("Basic Functionality", () => {
    it("should render nothing when isOpen is false", () => {
      mockUseAtMentionSearch.mockReturnValue([]);

      const { container } = render(
        <AtMentionTypeahead {...defaultProps} isOpen={false} />
      );

      expect(container.firstChild).toBeNull();
    });

    it("should call onClose when Escape is pressed", () => {
      mockUseAtMentionSearch.mockReturnValue([
        { key: "1", title: "Option", category: "notes", data: "file1" },
      ]);

      render(<AtMentionTypeahead {...defaultProps} />);

      const searchInput = screen.getByRole("textbox");
      fireEvent.keyDown(searchInput, { key: "Escape" });

      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it("should select enabled option and close on Enter", () => {
      mockUseAtMentionSearch.mockReturnValue([
        { key: "1", title: "Enabled Option", category: "notes", data: "file1", disabled: false },
      ]);

      render(<AtMentionTypeahead {...defaultProps} />);

      const searchInput = screen.getByRole("textbox");
      fireEvent.keyDown(searchInput, { key: "Enter" });

      expect(defaultProps.onSelect).toHaveBeenCalledWith("notes", "file1");
      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });
});
