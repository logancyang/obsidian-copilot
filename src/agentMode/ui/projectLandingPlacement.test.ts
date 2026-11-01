import {
  nextProjectLandingPlacement,
  type ProjectLandingPlacement,
} from "@/agentMode/ui/projectLandingPlacement";

const settledEmpty = { settled: true, chatCount: 0, archivedChatCount: 0 };

describe("projectLandingPlacement", () => {
  describe("nextProjectLandingPlacement()", () => {
    it("clears the placement when the pane is not showing a project landing", () => {
      const previous: ProjectLandingPlacement = { key: "p\0s", standalone: false };

      expect(nextProjectLandingPlacement(previous, null, settledEmpty)).toBeNull();
    });

    it("places a new visit with saved chats beside the shelf", () => {
      expect(nextProjectLandingPlacement(null, "p\0s", { ...settledEmpty, chatCount: 2 })).toEqual({
        key: "p\0s",
        standalone: false,
      });
    });

    it("places a new visit with no chats standalone", () => {
      expect(nextProjectLandingPlacement(null, "p\0s", settledEmpty)).toEqual({
        key: "p\0s",
        standalone: true,
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/805 keeps the shelf, and its View archived button, when every chat in the project is archived", () => {
      expect(
        nextProjectLandingPlacement(null, "p\0s", { ...settledEmpty, archivedChatCount: 3 })
      ).toEqual({ key: "p\0s", standalone: false });
    });

    it("moves a standalone visit to the shelf once its first chat appears", () => {
      const previous: ProjectLandingPlacement = { key: "p\0s", standalone: true };

      expect(
        nextProjectLandingPlacement(previous, "p\0s", { ...settledEmpty, chatCount: 1 })
      ).toEqual({ key: "p\0s", standalone: false });
    });

    it("keeps a visit's placement when its chats later disappear", () => {
      const previous: ProjectLandingPlacement = { key: "p\0s", standalone: false };

      expect(nextProjectLandingPlacement(previous, "p\0s", settledEmpty)).toBe(previous);
    });

    it("withholds the placement until the first history load of a new visit settles", () => {
      expect(
        nextProjectLandingPlacement({ key: "other\0s", standalone: false }, "p\0s", {
          ...settledEmpty,
          settled: false,
        })
      ).toBeNull();
    });

    it("keeps the current visit's placement while a history reload is in flight", () => {
      const previous: ProjectLandingPlacement = { key: "p\0s", standalone: false };

      expect(
        nextProjectLandingPlacement(previous, "p\0s", { ...settledEmpty, settled: false })
      ).toBe(previous);
    });
  });
});
