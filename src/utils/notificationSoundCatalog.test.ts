import { NOTIFICATION_SOUNDS, isNotificationSoundId } from "@/utils/notificationSoundCatalog";

describe("notificationSoundCatalog", () => {
  describe("isNotificationSoundId()", () => {
    it("accepts every catalog id and rejects anything else", () => {
      for (const id of Object.keys(NOTIFICATION_SOUNDS)) {
        expect(isNotificationSoundId(id)).toBe(true);
      }
      expect(isNotificationSoundId("removed-sound")).toBe(false);
      expect(isNotificationSoundId(undefined)).toBe(false);
    });

    it("rejects inherited property names from persisted data (https://github.com/logancyang/obsidian-copilot/issues/2987)", () => {
      expect(isNotificationSoundId("toString")).toBe(false);
      expect(isNotificationSoundId("constructor")).toBe(false);
      expect(isNotificationSoundId("__proto__")).toBe(false);
    });
  });
});
