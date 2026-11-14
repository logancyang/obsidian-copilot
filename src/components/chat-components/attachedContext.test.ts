import { attachedContext } from "@/components/chat-components/attachedContext";
import { TFile } from "obsidian";

const file = (path: string): TFile => new (TFile as unknown as new (path: string) => TFile)(path);

describe("attachedContext", () => {
  describe("attachedContext()", () => {
    it("keeps every attached item of a message that mentions none of them", () => {
      const context = {
        notes: [file("Notes/Plan.md")],
        urls: ["https://example.com/a"],
        folders: ["Research"],
        webTabs: [{ url: "https://example.com/board", title: "Board" }],
      };

      expect(attachedContext(context, "compare them")).toEqual(context);
    });

    it("leaves out the note, PDF, folder, URL and web tab the message text mentions (https://github.com/Brevilabs/obsidian-copilot-private/issues/932)", () => {
      const kept = file("Notes/Kept.md");
      const context = {
        notes: [file("Notes/Plan.md"), file("Docs/Spec.pdf"), kept],
        urls: ["https://example.com/a", "https://example.com/kept"],
        folders: ["Research/Pricing", "Daily"],
        webTabs: [
          { url: "https://example.com/board", title: "Board" },
          { url: "https://example.com/other", title: "Other" },
        ],
      };

      expect(
        attachedContext(
          context,
          "Compare [[Plan]] and [[Spec.pdf]] with {Research/Pricing}, https://example.com/a and [🌐: Board]"
        )
      ).toEqual({
        notes: [kept],
        urls: ["https://example.com/kept"],
        folders: ["Daily"],
        webTabs: [{ url: "https://example.com/other", title: "Other" }],
      });
    });
  });
});
