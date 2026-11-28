import {
  dayLabels,
  formatDayLabel,
  formatMessageClock,
  formatMessageDateTime,
  startOfDay,
} from "@/lib/messageTime";

const at = (y: number, month: number, d: number, h = 12, min = 0, s = 0) =>
  new Date(y, month - 1, d, h, min, s).getTime();

const WEDNESDAY_NOV_18_2026_AFTERNOON = at(2026, 11, 18, 15, 0);
const NOW = WEDNESDAY_NOV_18_2026_AFTERNOON;

describe("messageTime", () => {
  describe("startOfDay()", () => {
    it("returns local midnight of the day that holds the time", () => {
      expect(startOfDay(at(2026, 11, 18, 23, 59, 59))).toBe(at(2026, 11, 18, 0, 0, 0));
    });
  });

  describe("formatMessageClock()", () => {
    it("shows hours and minutes on a 12-hour clock in a 12-hour locale", () => {
      expect(formatMessageClock(at(2026, 11, 18, 14, 2, 11), "en-US")).toBe("2:02 PM");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 follows a 24-hour locale's clock", () => {
      expect(formatMessageClock(at(2026, 11, 18, 14, 2, 11), "en-GB")).toBe("14:02");
    });
  });

  describe("formatMessageDateTime()", () => {
    it("spells out the date and the time to the second for the tooltip", () => {
      expect(formatMessageDateTime(at(2026, 11, 18, 14, 2, 11), "en-US")).toBe(
        "November 18, 2026 at 2:02:11 PM"
      );
    });
  });

  describe("formatDayLabel()", () => {
    it.each([
      ["earlier the same day", at(2026, 11, 18, 0, 5), "Today"],
      ["the day before", at(2026, 11, 17, 23, 50), "Yesterday"],
      ["two days before, as its weekday", at(2026, 11, 16), "Monday"],
      ["seven days before, as its weekday", at(2026, 11, 11), "Wednesday"],
      ["eight days before, as its date", at(2026, 11, 10), "Nov 10"],
      ["earlier this year, as its date", at(2026, 2, 3), "Feb 3"],
    ])("labels a message from %s", (_case, sentAt, label) => {
      expect(formatDayLabel(sentAt, NOW, "en-US")).toBe(label);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 adds the year to a date from another year", () => {
      expect(formatDayLabel(at(2025, 12, 30), at(2026, 1, 9), "en-US")).toBe("Dec 30, 2025");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 calls the day before Yesterday across a daylight saving change", () => {
      expect(formatDayLabel(at(2026, 3, 7, 23), at(2026, 3, 8, 12), "en-US")).toBe("Yesterday");
      expect(formatDayLabel(at(2026, 10, 31, 23), at(2026, 11, 1, 12), "en-US")).toBe("Yesterday");
    });

    it("names the weekday in the given locale", () => {
      expect(formatDayLabel(at(2026, 11, 16), NOW, "fr-FR")).toBe("lundi");
    });
  });

  describe("dayLabels()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 puts no label in a chat that began today", () => {
      const labels = dayLabels([at(2026, 11, 18, 9), at(2026, 11, 18, 9, 1)], NOW, "en-US");

      expect([...labels]).toEqual([]);
    });

    it("labels the first message of each day in a chat that spans days", () => {
      const labels = dayLabels(
        [
          at(2026, 11, 17, 14, 2),
          at(2026, 11, 17, 14, 3),
          at(2026, 11, 18, 9, 15),
          at(2026, 11, 18, 9, 16),
        ],
        NOW,
        "en-US"
      );

      expect([...labels]).toEqual([
        [0, "Yesterday"],
        [2, "Today"],
      ]);
    });

    it("labels the top of a chat that began today once it is opened the next day", () => {
      const messages = [at(2026, 11, 18, 9), at(2026, 11, 18, 9, 1)];

      expect([...dayLabels(messages, at(2026, 11, 19, 8), "en-US")]).toEqual([[0, "Yesterday"]]);
    });

    it("skips messages without a time and labels the next message that has one", () => {
      const labels = dayLabels(
        [undefined, at(2026, 11, 10), undefined, at(2026, 11, 18)],
        NOW,
        "en-US"
      );

      expect([...labels]).toEqual([
        [1, "Nov 10"],
        [3, "Today"],
      ]);
    });
  });
});
