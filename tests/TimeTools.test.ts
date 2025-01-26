import { DateTime } from "luxon";
import { getTimeRangeMsTool } from "../src/tools/TimeTools";

// Extract the function from the tool
const getTimeRangeMs = async (timeExpression: string) => {
  return await getTimeRangeMsTool.func({ timeExpression });
};

// Mock the current date to ensure consistent test results
const mockNow = DateTime.fromObject({
  year: 2024,
  month: 1,
  day: 15,
  hour: 12,
}) as DateTime<true>;

describe("Time Expression Tests", () => {
  beforeAll(() => {
    // Mock DateTime.now()
    jest.spyOn(DateTime, "now").mockImplementation(() => mockNow);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  describe("Relative Time Ranges", () => {
    test("last X days", async () => {
      const result = await getTimeRangeMs("last 3 days");
      expect(result).toBeDefined();
      const startDate = DateTime.fromMillis(result!.startTime.epoch);
      const endDate = DateTime.fromMillis(result!.endTime.epoch);

      expect(startDate.toISODate()).toBe("2024-01-12");
      expect(endDate.toISODate()).toBe("2024-01-15");
    });

    test("past X weeks", async () => {
      const result = await getTimeRangeMs("past 2 weeks");
      expect(result).toBeDefined();
      const startDate = DateTime.fromMillis(result!.startTime.epoch);
      const endDate = DateTime.fromMillis(result!.endTime.epoch);

      expect(startDate.toISODate()).toBe("2024-01-01");
      expect(endDate.toISODate()).toBe("2024-01-15");
    });
  });

  describe("Special Time Ranges", () => {
    test("yesterday", async () => {
      const result = await getTimeRangeMs("yesterday");
      expect(result).toBeDefined();
      const startDate = DateTime.fromMillis(result!.startTime.epoch);
      const endDate = DateTime.fromMillis(result!.endTime.epoch);

      expect(startDate.toISODate()).toBe("2024-01-14");
      expect(endDate.toISODate()).toBe("2024-01-14");
    });

    test("last week", async () => {
      const result = await getTimeRangeMs("last week");
      expect(result).toBeDefined();
      const startDate = DateTime.fromMillis(result!.startTime.epoch);
      const endDate = DateTime.fromMillis(result!.endTime.epoch);

      expect(startDate.weekday).toBe(1); // Monday
      expect(endDate.weekday).toBe(7); // Sunday
      expect(startDate.weekNumber).toBe(endDate.weekNumber);
    });

    test("this month", async () => {
      const result = await getTimeRangeMs("this month");
      expect(result).toBeDefined();
      const startDate = DateTime.fromMillis(result!.startTime.epoch);
      const endDate = DateTime.fromMillis(result!.endTime.epoch);

      expect(startDate.toISODate()).toBe("2024-01-01");
      expect(endDate.toISODate()).toBe("2024-01-31");
    });
  });

  describe("Week of Expressions", () => {
    test("week of specific date", async () => {
      const result = await getTimeRangeMs("week of July 1st");
      expect(result).toBeDefined();
      const startDate = DateTime.fromMillis(result!.startTime.epoch);
      const endDate = DateTime.fromMillis(result!.endTime.epoch);

      // A full week is 7 days when including both start and end dates
      expect(Math.round(endDate.diff(startDate, "days").days)).toBe(7); // 8 days total (inclusive)
      expect(startDate.hour).toBe(0); // Start of day
      expect(endDate.hour).toBe(23); // End of day

      // Verify it's in July
      expect(startDate.month).toBe(7); // July
    });
  });

  describe("Month Names", () => {
    const monthTests = [
      { full: "january", abbr: "jan", num: 1, days: 31 },
      { full: "february", abbr: "feb", num: 2, days: 28 }, // Not leap year for 2023
      { full: "march", abbr: "mar", num: 3, days: 31 },
      { full: "april", abbr: "apr", num: 4, days: 30 },
      { full: "may", abbr: "may", num: 5, days: 31 },
      { full: "june", abbr: "jun", num: 6, days: 30 },
      { full: "july", abbr: "jul", num: 7, days: 31 },
      { full: "august", abbr: "aug", num: 8, days: 31 },
      { full: "september", abbr: "sep", num: 9, days: 30 },
      { full: "october", abbr: "oct", num: 10, days: 31 },
      { full: "november", abbr: "nov", num: 11, days: 30 },
      { full: "december", abbr: "dec", num: 12, days: 31 },
    ];

    describe("full month names", () => {
      monthTests.forEach(({ full, num, days }) => {
        test(`full month name: ${full}`, async () => {
          const result = await getTimeRangeMs(full);
          expect(result).toBeDefined();
          const startDate = DateTime.fromMillis(result!.startTime.epoch);
          const endDate = DateTime.fromMillis(result!.endTime.epoch);

          // If month is after current month (Jan), it should be in previous year
          const expectedYear = num > mockNow.month ? mockNow.year - 1 : mockNow.year;
          expect(startDate.toISODate()).toBe(
            `${expectedYear}-${num.toString().padStart(2, "0")}-01`
          );
          expect(endDate.toISODate()).toBe(
            `${expectedYear}-${num.toString().padStart(2, "0")}-${days}`
          );
        });
      });
    });

    describe("abbreviated month names", () => {
      monthTests.forEach(({ abbr, num, days }) => {
        test(`abbreviated month name: ${abbr}`, async () => {
          const result = await getTimeRangeMs(abbr);
          expect(result).toBeDefined();
          const startDate = DateTime.fromMillis(result!.startTime.epoch);
          const endDate = DateTime.fromMillis(result!.endTime.epoch);

          // If month is after current month (Jan), it should be in previous year
          const expectedYear = num > mockNow.month ? mockNow.year - 1 : mockNow.year;
          expect(startDate.toISODate()).toBe(
            `${expectedYear}-${num.toString().padStart(2, "0")}-01`
          );
          expect(endDate.toISODate()).toBe(
            `${expectedYear}-${num.toString().padStart(2, "0")}-${days}`
          );
        });
      });
    });
  });

  describe("Month-Year Combinations", () => {
    const years = [2022, 2023]; // Only test past years since future years are adjusted
    const monthTests = [
      { full: "january", abbr: "jan", num: 1, days: 31 },
      { full: "february", abbr: "feb", num: 2, days: [28, 29] }, // Handle leap years
      { full: "march", abbr: "mar", num: 3, days: 31 },
      { full: "april", abbr: "apr", num: 4, days: 30 },
      { full: "may", abbr: "may", num: 5, days: 31 },
      { full: "june", abbr: "jun", num: 6, days: 30 },
      { full: "july", abbr: "jul", num: 7, days: 31 },
      { full: "august", abbr: "aug", num: 8, days: 31 },
      { full: "september", abbr: "sep", num: 9, days: 30 },
      { full: "october", abbr: "oct", num: 10, days: 31 },
      { full: "november", abbr: "nov", num: 11, days: 30 },
      { full: "december", abbr: "dec", num: 12, days: 31 },
    ];

    describe("full month names with year", () => {
      years.forEach((year) => {
        monthTests.forEach(({ full, num, days }) => {
          test(`full month and year: ${full} ${year}`, async () => {
            const result = await getTimeRangeMs(`${full} ${year}`);
            expect(result).toBeDefined();
            const startDate = DateTime.fromMillis(result!.startTime.epoch);
            const endDate = DateTime.fromMillis(result!.endTime.epoch);

            const lastDay = Array.isArray(days)
              ? DateTime.fromObject({ year }).isInLeapYear
                ? days[1]
                : days[0] // Proper leap year check
              : days;

            // When a year is specified, it should be used regardless of whether it's in the future
            expect(startDate.toISODate()).toBe(`${year}-${num.toString().padStart(2, "0")}-01`);
            expect(endDate.toISODate()).toBe(
              `${year}-${num.toString().padStart(2, "0")}-${lastDay}`
            );
          });
        });
      });
    });

    describe("abbreviated month names with year", () => {
      years.forEach((year) => {
        monthTests.forEach(({ abbr, num, days }) => {
          test(`abbreviated month and year: ${abbr} ${year}`, async () => {
            const result = await getTimeRangeMs(`${abbr} ${year}`);
            expect(result).toBeDefined();
            const startDate = DateTime.fromMillis(result!.startTime.epoch);
            const endDate = DateTime.fromMillis(result!.endTime.epoch);

            const lastDay = Array.isArray(days)
              ? DateTime.fromObject({ year }).isInLeapYear
                ? days[1]
                : days[0] // Proper leap year check
              : days;

            // When a year is specified, it should be used regardless of whether it's in the future
            expect(startDate.toISODate()).toBe(`${year}-${num.toString().padStart(2, "0")}-01`);
            expect(endDate.toISODate()).toBe(
              `${year}-${num.toString().padStart(2, "0")}-${lastDay}`
            );
          });
        });
      });
    });
  });

  describe("Quarter Expressions", () => {
    test("specific quarter", async () => {
      const result = await getTimeRangeMs("Q1 2024");
      expect(result).toBeDefined();
      const startDate = DateTime.fromMillis(result!.startTime.epoch);
      const endDate = DateTime.fromMillis(result!.endTime.epoch);

      expect(startDate.toISODate()).toBe("2024-01-01");
      expect(endDate.toISODate()).toBe("2024-03-31");
    });

    test("quarter with year first", async () => {
      const result = await getTimeRangeMs("2023 Q4");
      expect(result).toBeDefined();
      const startDate = DateTime.fromMillis(result!.startTime.epoch);
      const endDate = DateTime.fromMillis(result!.endTime.epoch);

      expect(startDate.toISODate()).toBe("2023-10-01");
      expect(endDate.toISODate()).toBe("2023-12-31");
    });
  });

  describe("Year Expressions", () => {
    test("year only", async () => {
      const result = await getTimeRangeMs("2023");
      expect(result).toBeDefined();
      const startDate = DateTime.fromMillis(result!.startTime.epoch);
      const endDate = DateTime.fromMillis(result!.endTime.epoch);

      expect(startDate.toISODate()).toBe("2023-01-01");
      expect(endDate.toISODate()).toBe("2023-12-31");
    });

    test("year with prefix", async () => {
      const result = await getTimeRangeMs("year 2023");
      expect(result).toBeDefined();
      const startDate = DateTime.fromMillis(result!.startTime.epoch);
      const endDate = DateTime.fromMillis(result!.endTime.epoch);

      expect(startDate.toISODate()).toBe("2023-01-01");
      expect(endDate.toISODate()).toBe("2023-12-31");
    });
  });

  describe("Invalid Expressions", () => {
    test("invalid time expression", async () => {
      const result = await getTimeRangeMs("invalid time");
      expect(result).toBeUndefined();
    });

    test("empty string", async () => {
      const result = await getTimeRangeMs("");
      expect(result).toBeUndefined();
    });
  });
});
