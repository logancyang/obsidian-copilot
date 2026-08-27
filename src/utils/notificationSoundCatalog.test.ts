import {
  NOTIFICATION_SOUNDS,
  NOTIFICATION_SOUND_OPTIONS,
  isNotificationSoundId,
} from "@/utils/notificationSoundCatalog";

describe("notificationSoundCatalog", () => {
  describe("isNotificationSoundId()", () => {
    it("accepts every catalog id and rejects anything else", () => {
      for (const id of Object.keys(NOTIFICATION_SOUNDS)) {
        expect(isNotificationSoundId(id)).toBe(true);
      }
      expect(isNotificationSoundId("removed-sound")).toBe(false);
      expect(isNotificationSoundId(undefined)).toBe(false);
    });
  });

  describe("NOTIFICATION_SOUND_OPTIONS", () => {
    it("offers every catalog sound to the picker under its own label", () => {
      expect(NOTIFICATION_SOUND_OPTIONS).toEqual(
        Object.entries(NOTIFICATION_SOUNDS).map(([value, spec]) => ({ label: spec.label, value }))
      );
    });
  });
});
