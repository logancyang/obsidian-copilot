import { TagSuggestionModal } from "@/components/modals/TagSuggestionModal";
import { RankedTagSuggestion } from "@/tagSuggestions/tagSuggestions";
import { App } from "obsidian";

describe("TagSuggestionModal", () => {
  describe("TagSuggestionModal", () => {
    const suggestions: RankedTagSuggestion[] = [
      { tag: "research", score: 0.9 },
      { tag: "writing", score: 0.8 },
    ];

    describe("getItems()", () => {
      it("returns suggestions in their server-ranked order", () => {
        const modal = new TagSuggestionModal({} as App, suggestions, jest.fn());

        expect(modal.getItems()).toEqual(suggestions);
      });
    });

    describe("getItemText()", () => {
      it("shows each suggestion as an Obsidian tag", () => {
        const modal = new TagSuggestionModal({} as App, suggestions, jest.fn());

        expect(modal.getItemText(suggestions[0])).toBe("#research");
      });
    });

    describe("onChooseItem()", () => {
      it("passes the selected tag to the command callback", () => {
        const onChoose = jest.fn();
        const modal = new TagSuggestionModal({} as App, suggestions, onChoose);

        modal.onChooseItem(suggestions[1]);

        expect(onChoose).toHaveBeenCalledWith("writing");
      });
    });
  });
});
