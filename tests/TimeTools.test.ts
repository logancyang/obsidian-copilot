import { DateTime } from "luxon";
import { getTimeRangeMsTool } from "../src/tools/TimeTools";

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
      {
        expression: "january",
        expected: { startDate: "2024-01-01", endDate: "2024-01-31" },
      },
      {
        expression: "december 2023",
        expected: { startDate: "2023-12-01", endDate: "2023-12-31" },
      },
    ])("$expression", async ({ expression, expected }) => {
      await verifyDateRange(expression, expected);
    });
  });

  describe("Quarter Patterns", () => {
    test.each([
      {
        expression: "Q1",
        expected: { startDate: "2024-01-01", endDate: "2024-03-31" },
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
