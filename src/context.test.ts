import { ChatViewEventTarget } from "@/context";
import { EVENT_NAMES } from "@/constants";
import { TFile } from "obsidian";

describe("context", () => {
  describe("ChatViewEventTarget", () => {
    describe("queueContextNote()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/579 notifies a mounted Agent Chat when a note is queued", () => {
        const bus = new ChatViewEventTarget();
        const listener = jest.fn();
        bus.addEventListener(EVENT_NAMES.ADD_NOTE_TO_CHAT_CONTEXT, listener);

        bus.queueContextNote(Object.assign(new TFile(), { path: "Research.md" }));

        expect(listener).toHaveBeenCalledTimes(1);
      });
    });

    describe("consumePendingContextNotes()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/579 returns distinct queued notes once in their original order", () => {
        const bus = new ChatViewEventTarget();
        const research = Object.assign(new TFile(), { path: "Research.md" });
        const journal = Object.assign(new TFile(), { path: "Journal.md" });

        bus.queueContextNote(research);
        bus.queueContextNote(journal);
        bus.queueContextNote(research);

        expect(bus.consumePendingContextNotes()).toEqual([research, journal]);
        expect(bus.consumePendingContextNotes()).toEqual([]);
      });
    });
  });
});
