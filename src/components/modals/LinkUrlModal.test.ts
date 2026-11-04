import { LinkUrlModal } from "@/components/modals/LinkUrlModal";
import { App } from "obsidian";

describe("LinkUrlModal", () => {
  describe("LinkUrlModal", () => {
    describe("getSuggestions()", () => {
      it("offers each web or YouTube link in the typed or pasted text, classified by kind", () => {
        const modal = new LinkUrlModal(new App(), jest.fn());

        expect(
          modal.getSuggestions("see https://example.com/brief and youtu.be/dQw4w9WgXcQ")
        ).toEqual([
          { id: "web:https://example.com/brief", url: "https://example.com/brief", type: "web" },
        ]);
        expect(modal.getSuggestions("youtu.be/dQw4w9WgXcQ")).toEqual([
          {
            id: "youtube:https://youtu.be/dQw4w9WgXcQ",
            url: "https://youtu.be/dQw4w9WgXcQ",
            type: "youtube",
          },
        ]);
      });

      it("offers nothing for text that is not a link", () => {
        const modal = new LinkUrlModal(new App(), jest.fn());

        expect(modal.getSuggestions("launch notes")).toEqual([]);
        expect(modal.getSuggestions("")).toEqual([]);
      });
    });

    describe("onChooseSuggestion()", () => {
      it("hands the chosen link to the caller", () => {
        const onChoose = jest.fn();
        const modal = new LinkUrlModal(new App(), onChoose);
        const [item] = modal.getSuggestions("https://example.com/brief");

        modal.onChooseSuggestion(item);

        expect(onChoose).toHaveBeenCalledWith(item);
      });
    });
  });
});
