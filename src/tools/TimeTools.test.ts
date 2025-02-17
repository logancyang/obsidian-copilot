import { DateTime } from "luxon";
import { getTimeRangeMsTool } from "./TimeTools";

// Helper function to extract the tool function
const getTimeRangeMs = async (timeExpression: string) => {
  return await getTimeRangeMsTool.func({ timeExpression });
};

// Helper to verify date ranges
interface DateRange {
  startDate: string;
  endDate: string;
}

const verifyDateRange = async (expression: string, expected: DateRange) => {
  const result = await getTimeRangeMs(expression);
  expect(result).toBeDefined();
  const startDate = DateTime.fromMillis(result!.startTime.epoch);
  const endDate = DateTime.fromMillis(result!.endTime.epoch);

  expect(startDate.toISODate()).toBe(expected.startDate);
  expect(endDate.toISODate()).toBe(expected.endDate);
};

// Mock the current date
const mockNow = DateTime.fromObject({
  year: 2024,
  month: 1,
  day: 15,
  hour: 12,
}) as DateTime<true>;

describe("Time Expression Tests", () => {
  beforeAll(() => {
    jest.spyOn(DateTime, "now").mockImplementation(() => mockNow);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  describe("Relative Time Ranges", () => {
    test.each([
      // Last X units
      {
        expression: "last week",
        expected: { startDate: "2024-01-08", endDate: "2024-01-14" },
      },
      {
        expression: "last month",
        expected: { startDate: "2023-12-01", endDate: "2023-12-31" },
      },
      {
        expression: "last year",
        expected: { startDate: "2023-01-01", endDate: "2023-12-31" },
      },
      {
        expression: "last 3 days",
        expected: { startDate: "2024-01-12", endDate: "2024-01-15" },
      },
      {
        expression: "last 2 weeks",
        expected: { startDate: "2024-01-01", endDate: "2024-01-15" },
      },
      {
        expression: "last 6 months",
        expected: { startDate: "2023-07-15", endDate: "2024-01-15" },
      },

      // This units
      {
        expression: "this week",
        expected: { startDate: "2024-01-15", endDate: "2024-01-21" },
      },
      {
        expression: "this month",
        expected: { startDate: "2024-01-01", endDate: "2024-01-31" },
      },
      {
        expression: "this year",
        expected: { startDate: "2024-01-01", endDate: "2024-12-31" },
      },

      // Next X units
      {
        expression: "next week",
        expected: { startDate: "2024-01-22", endDate: "2024-01-28" },
      },
      {
        expression: "next month",
        expected: { startDate: "2024-02-01", endDate: "2024-02-29" },
      },
    ])("$expression", async ({ expression, expected }) => {
      await verifyDateRange(expression, expected);
    });
  });

  describe("Week Patterns", () => {
    test.each([
      {
        expression: "week of 2024-01-10",
        expected: { startDate: "2024-01-08", endDate: "2024-01-14" },
      },
      {
        expression: "week of last monday",
        expected: { startDate: "2024-01-08", endDate: "2024-01-14" },
      },
      {
        expression: "week of january 10",
        expected: { startDate: "2024-01-08", endDate: "2024-01-14" },
      },
    ])("$expression", async ({ expression, expected }) => {
      await verifyDateRange(expression, expected);
    });
  });

  describe("Month Patterns", () => {
    test.each([
      // Full month names
      {
        expression: "January",
        expected: { startDate: "2024-01-01", endDate: "2024-01-31" },
      },
      {
        expression: "Jan",
        expected: { startDate: "2024-01-01", endDate: "2024-01-31" },
      },
      // Adjust the year to 2023 for months after the current month
      {
        expression: "February",
        expected: { startDate: "2023-02-01", endDate: "2023-02-28" },
      },
      {
        expression: "Feb",
        expected: { startDate: "2023-02-01", endDate: "2023-02-28" },
      },
      {
        expression: "March",
        expected: { startDate: "2023-03-01", endDate: "2023-03-31" },
      },
      {
        expression: "Mar",
        expected: { startDate: "2023-03-01", endDate: "2023-03-31" },
      },
      {
        expression: "april",
        expected: { startDate: "2023-04-01", endDate: "2023-04-30" },
      },
      {
        expression: "apr",
        expected: { startDate: "2023-04-01", endDate: "2023-04-30" },
      },
      {
        expression: "may",
        expected: { startDate: "2023-05-01", endDate: "2023-05-31" },
      },
      {
        expression: "june",
        expected: { startDate: "2023-06-01", endDate: "2023-06-30" },
      },
      {
        expression: "jun",
        expected: { startDate: "2023-06-01", endDate: "2023-06-30" },
      },
      {
        expression: "july",
        expected: { startDate: "2023-07-01", endDate: "2023-07-31" },
      },
      {
        expression: "jul",
        expected: { startDate: "2023-07-01", endDate: "2023-07-31" },
      },
      {
        expression: "august",
        expected: { startDate: "2023-08-01", endDate: "2023-08-31" },
      },
      {
        expression: "aug",
        expected: { startDate: "2023-08-01", endDate: "2023-08-31" },
      },
      {
        expression: "september",
        expected: { startDate: "2023-09-01", endDate: "2023-09-30" },
      },
      {
        expression: "sep",
        expected: { startDate: "2023-09-01", endDate: "2023-09-30" },
      },
      {
        expression: "october",
        expected: { startDate: "2023-10-01", endDate: "2023-10-31" },
      },
      {
        expression: "oct",
        expected: { startDate: "2023-10-01", endDate: "2023-10-31" },
      },
      {
        expression: "november",
        expected: { startDate: "2023-11-01", endDate: "2023-11-30" },
      },
      {
        expression: "nov",
        expected: { startDate: "2023-11-01", endDate: "2023-11-30" },
      },
      {
        expression: "december",
        expected: { startDate: "2023-12-01", endDate: "2023-12-31" },
      },
      {
        expression: "dec",
        expected: { startDate: "2023-12-01", endDate: "2023-12-31" },
      },
    ])("$expression", async ({ expression, expected }) => {
      await verifyDateRange(expression, expected);
    });
  });

  describe("Month Year Patterns", () => {
    const months = [
      { name: "january", abbr: "jan", days: { 2022: 31, 2023: 31 } },
      { name: "february", abbr: "feb", days: { 2022: 28, 2023: 28 } },
      { name: "march", abbr: "mar", days: { 2022: 31, 2023: 31 } },
      { name: "april", abbr: "apr", days: { 2022: 30, 2023: 30 } },
      { name: "may", abbr: "may", days: { 2022: 31, 2023: 31 } },
      { name: "june", abbr: "jun", days: { 2022: 30, 2023: 30 } },
      { name: "july", abbr: "jul", days: { 2022: 31, 2023: 31 } },
      { name: "august", abbr: "aug", days: { 2022: 31, 2023: 31 } },
      { name: "september", abbr: "sep", days: { 2022: 30, 2023: 30 } },
      { name: "october", abbr: "oct", days: { 2022: 31, 2023: 31 } },
      { name: "november", abbr: "nov", days: { 2022: 30, 2023: 30 } },
      { name: "december", abbr: "dec", days: { 2022: 31, 2023: 31 } },
    ] as const;

    const years = [2022, 2023] as const;
    type Year = (typeof years)[number];

    const historicalCases = months.flatMap((month) =>
      years.flatMap((year: Year) => [
        {
          expression: `${month.name} ${year}`,
          expected: {
            startDate: `${year}-${String(months.indexOf(month) + 1).padStart(2, "0")}-01`,
            endDate: `${year}-${String(months.indexOf(month) + 1).padStart(2, "0")}-${month.days[year]}`,
          },
        },
        {
          expression: `${month.abbr} ${year}`,
          expected: {
            startDate: `${year}-${String(months.indexOf(month) + 1).padStart(2, "0")}-01`,
            endDate: `${year}-${String(months.indexOf(month) + 1).padStart(2, "0")}-${month.days[year]}`,
          },
        },
      ])
    );

    test.each(historicalCases)("$expression", async ({ expression, expected }) => {
      await verifyDateRange(expression, expected);
    });
  });

  describe("Quarter Patterns", () => {
    test.each([
      {
        expression: "Q1",
        expected: { startDate: "2024-01-01", endDate: "2024-03-31" },
      },
      // Adjust the year to 2023 for quarters after the current quarter
      {
        expression: "Q3",
        expected: { startDate: "2023-07-01", endDate: "2023-09-30" },
      },
      {
        expression: "Q4 2023",
        expected: { startDate: "2023-10-01", endDate: "2023-12-31" },
      },
    ])("$expression", async ({ expression, expected }) => {
      await verifyDateRange(expression, expected);
    });
  });

  describe("Year Patterns", () => {
    test.each([
      {
        expression: "2023",
        expected: { startDate: "2023-01-01", endDate: "2023-12-31" },
      },
    ])("$expression", async ({ expression, expected }) => {
      await verifyDateRange(expression, expected);
    });
  });

  describe("Specific Date Patterns", () => {
    test.each([
      {
        expression: "2024-01-10",
        expected: { startDate: "2024-01-10", endDate: "2024-01-10" },
      },
      {
        expression: "January 10",
        expected: { startDate: "2024-01-10", endDate: "2024-01-10" },
      },
    ])("$expression", async ({ expression, expected }) => {
      await verifyDateRange(expression, expected);
    });
  });

  describe("Relative Date Patterns", () => {
    test.each([
      {
        expression: "last monday",
        expected: { startDate: "2024-01-08", endDate: "2024-01-08" },
      },
      {
        expression: "next friday",
        expected: { startDate: "2024-01-26", endDate: "2024-01-26" },
      },
      {
        expression: "today",
        expected: { startDate: "2024-01-15", endDate: "2024-01-15" },
      },
      {
        expression: "yesterday",
        expected: { startDate: "2024-01-14", endDate: "2024-01-14" },
      },
      {
        expression: "tomorrow",
        expected: { startDate: "2024-01-16", endDate: "2024-01-16" },
      },
    ])("$expression", async ({ expression, expected }) => {
      await verifyDateRange(expression, expected);
    });
  });

  describe("Date Range Patterns", () => {
    test.each([
      {
        expression: "from 2024-01-01 to 2024-01-15",
        expected: { startDate: "2024-01-01", endDate: "2024-01-15" },
      },
      {
        expression: "from january 1 to january 15",
        expected: { startDate: "2024-01-01", endDate: "2024-01-15" },
      },
      {
        expression: "from 2024-01-01 to now",
        expected: { startDate: "2024-01-01", endDate: "2024-01-15" },
      },
    ])("$expression", async ({ expression, expected }) => {
      await verifyDateRange(expression, expected);
    });
  });

  describe("Invalid Expressions", () => {
    test.each(["invalid time", "", "random text", "week of invalid"])(
      "invalid expression: %s",
      async (expression) => {
        const result = await getTimeRangeMs(expression);
        expect(result).toBeUndefined();
      }
    );
  });
});
