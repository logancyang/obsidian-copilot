import { DateTime } from "luxon";
import * as logger from "@/logger";
import {
  convertTimeBetweenTimezonesTool,
  getCurrentTimeTool,
  getTimeInfoByEpochTool,
  getTimeRangeMsTool,
} from "./TimeTools";

interface InvokableTool {
  invoke: (args: Record<string, unknown>) => Promise<unknown>;
}

interface TimeInfoResult {
  epoch: number;
  isoString: string;
  localDateString: string;
  timezoneOffset: number;
  timezone: string;
  originalTime?: string;
  convertedTime?: string;
}

const invoke = async <T>(tool: unknown, args: Record<string, unknown>): Promise<T> => {
  const result = await (tool as InvokableTool).invoke(args);
  return (typeof result === "string" ? JSON.parse(result) : result) as T;
};

const mockNow = DateTime.fromObject({
  year: 2024,
  month: 1,
  day: 15,
  hour: 12,
}) as DateTime<true>;

describe("TimeTools", () => {
  beforeAll(() => {
    jest.spyOn(DateTime, "now").mockImplementation(() => mockNow);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  describe("getTimeRangeMsTool", () => {
    let logWarnSpy: jest.SpyInstance;

    beforeEach(() => {
      logWarnSpy = jest.spyOn(logger, "logWarn").mockImplementation(() => {});
    });

    const resolveRange = async (timeExpression: string) => {
      const result = await invoke<{ startTime: number; endTime: number }>(getTimeRangeMsTool, {
        timeExpression,
      });
      return {
        startDate: DateTime.fromMillis(result.startTime).toISODate(),
        endDate: DateTime.fromMillis(result.endTime).toISODate(),
      };
    };

    it.each([
      ["last week", "2024-01-08", "2024-01-14"],
      ["last month", "2023-12-01", "2023-12-31"],
      ["last year", "2023-01-01", "2023-12-31"],
      ["last 3 days", "2024-01-12", "2024-01-15"],
      ["last 2 weeks", "2024-01-01", "2024-01-15"],
      ["last 6 months", "2023-07-15", "2024-01-15"],
      ["this week", "2024-01-15", "2024-01-21"],
      ["this month", "2024-01-01", "2024-01-31"],
      ["this year", "2024-01-01", "2024-12-31"],
      ["next week", "2024-01-22", "2024-01-28"],
      ["next month", "2024-02-01", "2024-02-29"],
    ])("resolves the relative range %j to %s through %s", async (expression, start, end) => {
      expect(await resolveRange(expression)).toEqual({ startDate: start, endDate: end });
    });

    it.each([
      ["today", "2024-01-15", "2024-01-15"],
      ["yesterday", "2024-01-14", "2024-01-14"],
      ["tomorrow", "2024-01-16", "2024-01-16"],
      ["last monday", "2024-01-08", "2024-01-08"],
      ["next friday", "2024-01-26", "2024-01-26"],
      ["2024-01-10", "2024-01-10", "2024-01-10"],
      ["January 10", "2024-01-10", "2024-01-10"],
    ])("resolves the single day %j to %s", async (expression, start, end) => {
      expect(await resolveRange(expression)).toEqual({ startDate: start, endDate: end });
    });

    it.each([
      ["from 2024-01-01 to 2024-01-15", "2024-01-01", "2024-01-15"],
      ["from january 1 to january 15", "2024-01-01", "2024-01-15"],
      ["from 2024-01-01 to now", "2024-01-01", "2024-01-15"],
    ])("resolves the explicit range %j to %s through %s", async (expression, start, end) => {
      expect(await resolveRange(expression)).toEqual({ startDate: start, endDate: end });
    });

    it.each([
      ["week of 2024-01-10", "2024-01-08", "2024-01-14"],
      ["week of last monday", "2024-01-08", "2024-01-14"],
      ["week of january 10", "2024-01-08", "2024-01-14"],
    ])("resolves %j to the Monday-to-Sunday week %s through %s", async (expression, start, end) => {
      expect(await resolveRange(expression)).toEqual({ startDate: start, endDate: end });
    });

    it.each([
      ["January", "2024-01-01", "2024-01-31"],
      ["Jan", "2024-01-01", "2024-01-31"],
      ["February", "2023-02-01", "2023-02-28"],
      ["sep", "2023-09-01", "2023-09-30"],
      ["December", "2023-12-01", "2023-12-31"],
    ])(
      "resolves the bare month %j to its most recent occurrence, %s through %s",
      async (expression, start, end) => {
        expect(await resolveRange(expression)).toEqual({ startDate: start, endDate: end });
      }
    );

    it.each([
      ["january 2023", "2023-01-01", "2023-01-31"],
      ["feb 2022", "2022-02-01", "2022-02-28"],
      ["april 2022", "2022-04-01", "2022-04-30"],
      ["dec 2023", "2023-12-01", "2023-12-31"],
    ])("resolves the month and year %j to %s through %s", async (expression, start, end) => {
      expect(await resolveRange(expression)).toEqual({ startDate: start, endDate: end });
    });

    it.each([
      ["Q1", "2024-01-01", "2024-03-31"],
      ["Q3", "2023-07-01", "2023-09-30"],
      ["Q4 2023", "2023-10-01", "2023-12-31"],
    ])("resolves the quarter %j to %s through %s", async (expression, start, end) => {
      expect(await resolveRange(expression)).toEqual({ startDate: start, endDate: end });
    });

    it("resolves a bare year to the whole calendar year", async () => {
      expect(await resolveRange("2023")).toEqual({
        startDate: "2023-01-01",
        endDate: "2023-12-31",
      });
    });

    it.each(["", "random text", "week of invalid"])(
      "returns an error and logs a warning when %j cannot be parsed",
      async (expression) => {
        const result = await invoke<{ error?: string }>(getTimeRangeMsTool, {
          timeExpression: expression,
        });

        expect(result.error).toBe(`Unable to parse time expression: ${expression}`);
        expect(logWarnSpy).toHaveBeenCalledWith(`Unable to parse time expression: ${expression}`);
      }
    );
  });

  describe("getCurrentTimeTool", () => {
    it("returns the current instant in the local zone when no offset is given", async () => {
      const result = await invoke<TimeInfoResult>(getCurrentTimeTool, {});

      expect(result.epoch).toBe(mockNow.toMillis());
      expect(result.localDateString).toBe("2024-01-15");
    });

    it.each([
      ["+9", 540],
      ["UTC+8", 480],
      ["GMT-5", -300],
      ["+5:30", 330],
      ["UTC+0", 0],
    ])("expresses the same instant at the offset %j (%d minutes)", async (offset, minutes) => {
      const result = await invoke<TimeInfoResult>(getCurrentTimeTool, { timezoneOffset: offset });

      expect(result.timezoneOffset).toBe(minutes);
      expect(result.epoch).toBe(mockNow.toMillis());
    });

    it("rejects a timezone name because only numeric offsets are supported", async () => {
      await expect(invoke(getCurrentTimeTool, { timezoneOffset: "Asia/Tokyo" })).rejects.toThrow(
        "Invalid timezone offset format"
      );
    });

    it("rejects an offset beyond +/-14 hours", async () => {
      await expect(invoke(getCurrentTimeTool, { timezoneOffset: "+25" })).rejects.toThrow(
        "Invalid timezone offset"
      );
    });
  });

  describe("getTimeInfoByEpochTool", () => {
    it("treats a 10-digit epoch as seconds and a 13-digit epoch as milliseconds", async () => {
      const fromSeconds = await invoke<TimeInfoResult>(getTimeInfoByEpochTool, {
        epoch: 1705320000,
      });
      const fromMillis = await invoke<TimeInfoResult>(getTimeInfoByEpochTool, {
        epoch: 1705320000000,
      });

      expect(fromSeconds.epoch).toBe(1705320000000);
      expect(fromSeconds.isoString).toBe("2024-01-15T12:00:00.000Z");
      expect(fromMillis).toEqual(fromSeconds);
    });
  });

  describe("convertTimeBetweenTimezonesTool", () => {
    it("converts an instant with an explicit offset across the date line into the target offset", async () => {
      const result = await invoke<TimeInfoResult>(convertTimeBetweenTimezonesTool, {
        time: "2024-01-15T18:00:00-08:00",
        fromOffset: "-8",
        toOffset: "+9",
      });

      expect(result.originalTime).toMatch(/^6:00\sPM\s/);
      expect(result.convertedTime).toMatch(/^11:00\sAM\s/);
      expect(result.localDateString).toBe("2024-01-16");
      expect(result.timezoneOffset).toBe(540);
    });

    it("keeps the wall-clock time when source and target offsets are equal", async () => {
      const result = await invoke<TimeInfoResult>(convertTimeBetweenTimezonesTool, {
        time: "2024-01-15T12:00:00-05:00",
        fromOffset: "-5",
        toOffset: "UTC-5",
      });

      expect(result.convertedTime).toBe(result.originalTime);
      expect(result.timezoneOffset).toBe(-300);
    });

    it("rejects a time string it cannot parse", async () => {
      await expect(
        invoke(convertTimeBetweenTimezonesTool, {
          time: "invalid time",
          fromOffset: "-8",
          toOffset: "+0",
        })
      ).rejects.toThrow("Could not parse time");
    });
  });
});
