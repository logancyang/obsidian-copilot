import { TypeaheadMenuContent, type TypeaheadOption } from "./TypeaheadMenuContent";
import { fireEvent, render, screen } from "@testing-library/react";
import { FileText, UserPlus } from "lucide-react";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/582";
const LAPSED_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/950";
const STILL_POINTER_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/947";

const NOTES: TypeaheadOption = {
  key: "notes",
  title: "Notes",
  icon: <FileText className="tw-size-4" />,
};

const ASK_AN_AGENT: TypeaheadOption = {
  key: "locked-agents",
  title: "Ask an agent",
  icon: <UserPlus className="tw-size-4" />,
  lockedNote: "Supporter preview",
};

const FOLDERS: TypeaheadOption = {
  key: "folders",
  title: "Folders",
  icon: <FileText className="tw-size-4" />,
};

function renderMenu(options: TypeaheadOption[], onSelect = jest.fn(), onHighlight = jest.fn()) {
  const view = render(
    <TypeaheadMenuContent
      options={options}
      selectedIndex={0}
      onSelect={onSelect}
      onHighlight={onHighlight}
      mode="category"
    />
  );
  return { ...view, onSelect, onHighlight };
}

describe("TypeaheadMenuContent", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn();
  });

  describe("TypeaheadMenuContent()", () => {
    it("shows each category with an arrow that leads into it", () => {
      const { container } = renderMenu([NOTES]);

      expect(screen.getByText("Notes")).toBeTruthy();
      expect(container.querySelector(".lucide-chevron-right")).not.toBeNull();
    });

    it(`highlights the row the pointer moves onto once, however far it moves within it (${STILL_POINTER_ISSUE})`, () => {
      const { onHighlight } = renderMenu([NOTES, FOLDERS]);

      fireEvent.mouseMove(screen.getByText("Folders"));
      fireEvent.mouseMove(screen.getByText("Folders"));

      expect(onHighlight).toHaveBeenCalledTimes(1);
      expect(onHighlight).toHaveBeenCalledWith(1);
    });

    it(`keeps the selection when a row appears under a pointer that has not moved, so Enter picks the first result (${STILL_POINTER_ISSUE})`, () => {
      const { onHighlight } = renderMenu([NOTES, FOLDERS]);

      fireEvent.mouseEnter(screen.getByText("Folders"));

      expect(onHighlight).not.toHaveBeenCalled();
    });

    it(`shows a locked row below a divider, with its note and a lock in place of the arrow (${ISSUE})`, () => {
      const { container, onSelect } = renderMenu([NOTES, ASK_AN_AGENT]);

      const title = screen.getByText("Ask an agent");
      expect(screen.getByText("Supporter preview")).toBeTruthy();
      expect(container.querySelectorAll(".lucide-chevron-right")).toHaveLength(1);
      expect(container.querySelectorAll(".lucide-lock")).toHaveLength(1);
      const separators = container.querySelectorAll('[role="separator"]');
      expect(separators).toHaveLength(1);
      expect(
        screen.getByText("Notes").compareDocumentPosition(separators[0]) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        separators[0].compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();

      fireEvent.mouseDown(title);
      expect(onSelect).toHaveBeenCalledWith(ASK_AN_AGENT);
    });
    it(`shows a locked agent among the first results with a lock at its end and no divider (${LAPSED_ISSUE})`, () => {
      const maya = {
        key: "custom-agent-maya",
        title: "Maya",
        subtitle: "Product critic",
        data: "maya",
        lockedNote: "Supporter preview",
      } as TypeaheadOption;
      const { container, onSelect } = renderMenu([maya, NOTES]);

      expect(screen.getByLabelText("Supporter preview")).toBeTruthy();
      expect(container.querySelectorAll('[role="separator"]')).toHaveLength(0);

      fireEvent.mouseDown(screen.getByText("Maya"));
      expect(onSelect).toHaveBeenCalledWith(maya);
    });
  });
});
