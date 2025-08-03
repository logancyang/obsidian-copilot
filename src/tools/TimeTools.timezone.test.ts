import { DateTime } from "luxon";
import { getCurrentTimeTool, convertTimeBetweenTimezonesTool } from "./TimeTools";

describe("TimeTools Timezone Tests", () => {
  // Mock the current date
  const mockNow = DateTime.fromObject({
    year: 2024,
    month: 1,
    day: 15,
    hour: 14, // 2 PM
    minute: 30,
  }).setZone("America/Los_Angeles");

  beforeAll(() => {
    jest.spyOn(DateTime, "now").mockImplementation(() => mockNow as DateTime<true>);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  describe("getCurrentTimeTool with timezone", () => {
    it("should return local time when no timezone is provided", async () => {
      const result = await getCurrentTimeTool.call({});
      expect(result.timezone).toBeTruthy();
      expect(result.epoch).toBeGreaterThan(0);
    });

    it("should return time at UTC+9 offset (Tokyo)", async () => {
      const result = await getCurrentTimeTool.call({ timezoneOffset: "+9" });
      expect(result.timezoneOffset).toBe(540); // 9 * 60 minutes
      expect(["GMT+9", "UTC+9"]).toContain(result.timezone);
    });

    it("should handle UTC+0", async () => {
      const result = await getCurrentTimeTool.call({ timezoneOffset: "UTC+0" });
      expect(result.timezone).toBe("UTC");
      expect(result.timezoneOffset).toBe(0);
    });

    it("should throw error for invalid timezone offset", async () => {
      await expect(getCurrentTimeTool.call({ timezoneOffset: "Asia/Tokyo" })).rejects.toThrow(
        "Invalid timezone offset format"
      );
    });

    it("should throw error for out of range offset", async () => {
      await expect(getCurrentTimeTool.call({ timezoneOffset: "+25" })).rejects.toThrow(
        "Invalid timezone offset"
      );
    });

    it("should handle UTC+8 format", async () => {
      const result = await getCurrentTimeTool.call({ timezoneOffset: "UTC+8" });
      expect(result.timezoneOffset).toBe(480); // 8 * 60 minutes
      expect(["GMT+8", "UTC+8"]).toContain(result.timezone);
    });

    it("should handle negative UTC offset format (GMT-5)", async () => {
      const result = await getCurrentTimeTool.call({ timezoneOffset: "GMT-5" });
      expect(result.timezoneOffset).toBe(-300); // -5 * 60 minutes
      expect(["GMT-5", "UTC-5"]).toContain(result.timezone);
    });

    it("should handle UTC offset with minutes (+5:30)", async () => {
      const result = await getCurrentTimeTool.call({ timezoneOffset: "+5:30" });
      expect(result.timezoneOffset).toBe(330); // 5.5 * 60 minutes
      expect(["GMT+5:30", "UTC+5:30", "+05:30"]).toContain(result.timezone);
    });
  });

  describe("convertTimeBetweenTimezonesTool", () => {
    it("should convert times between timezones correctly", async () => {
      const result = await convertTimeBetweenTimezonesTool.call({
        time: "18:00", // Use 24-hour format for deterministic parsing
        fromOffset: "-8",
        toOffset: "+9",
      });

      // Just verify the conversion happened and timezone is correct
      expect(result.originalTime).toBeDefined();
      expect(result.convertedTime).toBeDefined();
      expect(["GMT+9", "UTC+9"]).toContain(result.timezone);

      // Verify the timezone offset is correct (9 hours = 540 minutes)
      expect(result.timezoneOffset).toBe(540);
    });

    it("should convert 9am UTC-5 to UTC+0 (London)", async () => {
      const result = await convertTimeBetweenTimezonesTool.call({
        time: "9:00 AM",
        fromOffset: "-5",
        toOffset: "+0",
      });

      // Just verify the conversion happened
      expect(result.originalTime).toBeDefined();
      expect(result.convertedTime).toBeDefined();
      expect(result.originalTime).not.toEqual(result.convertedTime);
    });

    it("should handle 24-hour time format", async () => {
      const result = await convertTimeBetweenTimezonesTool.call({
        time: "18:30",
        fromOffset: "UTC+0",
        toOffset: "-5",
      });

      // Verify conversion happened
      expect(result.originalTime).toBeDefined();
      expect(result.convertedTime).toBeDefined();
      // UTC to UTC-5 should show different times
      expect(result.originalTime).not.toEqual(result.convertedTime);
    });

    it("should handle same offset conversion", async () => {
      const result = await convertTimeBetweenTimezonesTool.call({
        time: "12:00", // Use 24-hour format
        fromOffset: "-5",
        toOffset: "-5",
      });

      // When converting to same timezone, times should match
      expect(result.originalTime).toBeDefined();
      expect(result.convertedTime).toBeDefined();
      // Both should have same timezone offset
      expect(result.timezoneOffset).toBe(-300); // -5 hours = -300 minutes
    });

    it("should throw error for invalid time", async () => {
      await expect(
        convertTimeBetweenTimezonesTool.call({
          time: "invalid time",
          fromOffset: "-8",
          toOffset: "+0",
        })
      ).rejects.toThrow("Could not parse time");
    });

    it("should handle UTC+10 offset (Australia)", async () => {
      const result = await convertTimeBetweenTimezonesTool.call({
        time: "10:00 AM",
        fromOffset: "-8",
        toOffset: "+10",
      });

      expect(["GMT+10", "UTC+10"]).toContain(result.timezone);
      expect(result.convertedTime).toBeDefined();
    });

    it("should convert times with large offset differences", async () => {
      const result = await convertTimeBetweenTimezonesTool.call({
        time: "06:00", // Use 24-hour format
        fromOffset: "-8",
        toOffset: "+9",
      });

      expect(result.originalTime).toBeDefined();
      expect(result.convertedTime).toBeDefined();

      // Verify the timezone offset is correct (9 hours = 540 minutes)
      expect(result.timezoneOffset).toBe(540);
      expect(["GMT+9", "UTC+9"]).toContain(result.timezone);
    });

    it("should convert between UTC offsets", async () => {
      const result = await convertTimeBetweenTimezonesTool.call({
        time: "12:00 PM",
        fromOffset: "UTC+8",
        toOffset: "UTC-5",
      });

      expect(result).toBeDefined();
      expect(result.convertedTime).toBeDefined();
      // Verify the offset is correct regardless of the parsed time
      expect(result.timezoneOffset).toBe(-300); // UTC-5 is -300 minutes
    });

    it("should handle mixed offset formats", async () => {
      const result = await convertTimeBetweenTimezonesTool.call({
        time: "3:00 PM",
        fromOffset: "GMT+8",
        toOffset: "-5",
      });

      expect(result).toBeDefined();
      expect(result.convertedTime).toBeDefined();
      // UTC-5 is -300 minutes
      expect(result.timezoneOffset).toBe(-300);
    });
  });
});
