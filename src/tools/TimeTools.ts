import { tool } from "@langchain/core/tools";
import * as chrono from "chrono-node";
import { DateTime } from "luxon";
import { Notice } from "obsidian";
import { z } from "zod";

export interface TimeInfo {
  epoch: number;
  isoString: string;
  userLocaleString: string;
  localDateString: string;
  timezoneOffset: number;
  timezone: string;
}

async function getCurrentTime(): Promise<TimeInfo> {
  const now = new Date();
  const timezoneOffset = now.getTimezoneOffset();
  const timezoneAbbr =
    new Intl.DateTimeFormat("en", { timeZoneName: "short" })
      .formatToParts(now)
      .find((part) => part.type === "timeZoneName")?.value || "Unknown";

  return {
    epoch: Math.floor(now.getTime()),
    isoString: now.toISOString(),
    userLocaleString: now.toLocaleString(),
    localDateString: now.toLocaleDateString("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
    timezoneOffset: -timezoneOffset, // Invert the offset to match common conventions
    timezone: timezoneAbbr,
  };
}

const getCurrentTimeTool = tool(async () => getCurrentTime(), {
  name: "getCurrentTime",
  description: "Get the current time in various formats, including timezone information",
  schema: z.object({}), // No input required
});

const monthNames = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
} as const;

/**
 * Handles relative time range patterns like:
 * - "last 3 days", "past 3 days"
 * - "last 2 weeks", "past 2 weeks"
 * - "last 6 months", "previous 6 months"
 * - "last 2 years", "prior 2 years"
 */
function handleRelativeTimeRange(input: string, now: DateTime) {
  // Match numeric patterns with various past-tense prefixes
  const relativeMatch = input.match(
    /^(last|past|previous|prior)\s+(\d+)\s+(days?|weeks?|months?|years?)$/i
  );

  if (!relativeMatch) return undefined;

  const [, , amountStr, unit] = relativeMatch;
  const amount = parseInt(amountStr);

  if (amount <= 0) {
    return undefined;
  }

  const unitSingular = unit.replace(/s$/, "") as "day" | "week" | "month" | "year";

  const end = now.startOf("day");
  const start = end.minus({ [unitSingular + "s"]: amount });
  return { start, end };
}

/**
 * Handles special time ranges like:
 * - "yesterday"
 * - "last week", "this week", "next week"
 * - "last month", "this month", "next month"
 * - "last year", "this year", "next year"
 */
function handleSpecialTimeRanges(input: string, now: DateTime) {
  switch (input) {
    case "yesterday":
      return {
        start: now.minus({ days: 1 }).startOf("day"),
        end: now.minus({ days: 1 }).endOf("day"),
      };
    case "last week":
      return {
        start: now.minus({ weeks: 1 }).startOf("week"),
        end: now.minus({ weeks: 1 }).endOf("week"),
      };
    // ... other cases
  }
  return undefined;
}

/**
 * Handles "week of" pattern like:
 * - "week of July 1st"
 * - "week of 2023-07-01"
 * - "the week of last Monday"
 */
function handleWeekOf(input: string, now: DateTime) {
  const weekOfMatch = input.match(/(?:the\s+)?week\s+of\s+(.+)/i);
  if (!weekOfMatch) return undefined;

  const dateStr = weekOfMatch[1];
  const parsedDates = chrono.parse(dateStr, now.toJSDate(), { forwardDate: false });
  if (parsedDates.length === 0) return undefined;

  let start = DateTime.fromJSDate(parsedDates[0].start.date()).startOf("week");
  let end = start.endOf("week");

  if (start > now) {
    start = start.minus({ years: 1 });
    end = end.minus({ years: 1 });
  }

  return { start, end };
}

/**
 * Handles single month names like:
 * - "january", "jan"
 * - "december", "dec"
 */
function handleMonthName(input: string, now: DateTime) {
  const monthMatch = input.match(
    /^(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|september|oct|october|nov|november|dec|december)$/i
  );
  if (!monthMatch) return undefined;

  const monthNum = monthNames[monthMatch[1] as keyof typeof monthNames];
  let year = now.year;

  if (monthNum > now.month) {
    year--;
  }

  let start = DateTime.fromObject({
    year,
    month: monthNum,
    day: 1,
  });
  let end = start.endOf("month");

  if (start > now) {
    start = start.minus({ years: 1 });
    end = end.minus({ years: 1 });
  }

  return { start, end };
}

/**
 * Handles year patterns like:
 * - "2023"
 * - "year 2023"
 * - "the year of 2023"
 */
function handleYear(input: string, now: DateTime) {
  const yearMatch = input.match(/^(?:(?:the\s+)?(?:year|yr)(?:\s+(?:of|in))?\s+)?(\d{4})$/i);
  if (!yearMatch) return undefined;

  const year = parseInt(yearMatch[1]);
  let start = DateTime.fromObject({ year, month: 1, day: 1 });
  let end = DateTime.fromObject({ year, month: 12, day: 31 });

  if (start > now) {
    start = start.minus({ years: 1 });
    end = end.minus({ years: 1 });
  }

  return { start, end };
}

function getTimeRangeMs(timeExpression: string) {
  const now = DateTime.now();
  const normalizedInput = timeExpression.toLowerCase().replace("@vault", "").trim();

  // Try each parser in sequence
  const result =
    handleRelativeTimeRange(normalizedInput, now) ||
    handleSpecialTimeRanges(normalizedInput, now) ||
    handleWeekOf(normalizedInput, now) ||
    handleMonthName(normalizedInput, now) ||
    handleYear(normalizedInput, now);

  if (result) {
    return {
      startTime: convertToTimeInfo(result.start),
      endTime: convertToTimeInfo(result.end),
    };
  }

  // Fallback to chrono parser for other date formats
  const parsedDates = chrono.parse(timeExpression, now.toJSDate(), { forwardDate: false });
  if (parsedDates.length > 0) {
    const start = DateTime.fromJSDate(parsedDates[0].start.date()).startOf("day");
    const end = parsedDates[0].end
      ? DateTime.fromJSDate(parsedDates[0].end.date()).endOf("day")
      : start.endOf("day");

    if (start > now) {
      start.minus({ years: 1 });
      end.minus({ years: 1 });
    }

    return {
      startTime: convertToTimeInfo(start),
      endTime: convertToTimeInfo(end),
    };
  }

  console.warn(`Unable to parse time expression: ${timeExpression}`);
  return undefined;
}

function convertToTimeInfo(dateTime: DateTime): TimeInfo {
  const jsDate = dateTime.toJSDate();
  const timezoneOffset = jsDate.getTimezoneOffset();
  const timezoneAbbr =
    new Intl.DateTimeFormat("en", { timeZoneName: "short" })
      .formatToParts(jsDate)
      .find((part) => part.type === "timeZoneName")?.value || "Unknown";

  return {
    epoch: Math.floor(jsDate.getTime()),
    isoString: jsDate.toISOString(),
    userLocaleString: jsDate.toLocaleString(),
    localDateString: jsDate.toLocaleDateString("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
    timezoneOffset: -timezoneOffset,
    timezone: timezoneAbbr,
  };
}

const getTimeRangeMsTool = tool(
  async ({ timeExpression }: { timeExpression: string }) => getTimeRangeMs(timeExpression),
  {
    name: "getTimeRangeMs",
    description: "Get a time range in milliseconds based on a natural language time expression",
    schema: z.object({
      timeExpression: z
        .string()
        .describe(
          "A natural language time expression (e.g., 'last week', 'from July 1 to July 15')"
        ),
    }),
  }
);

function getTimeInfoByEpoch(epoch: number): TimeInfo {
  // Check if the epoch is in seconds (10 digits) or milliseconds (13 digits)
  const epochMs = epoch.toString().length === 10 ? epoch * 1000 : epoch;
  const dateTime = DateTime.fromMillis(epochMs);
  return convertToTimeInfo(dateTime);
}

const getTimeInfoByEpochTool = tool(
  async ({ epoch }: { epoch: number }) => getTimeInfoByEpoch(epoch),
  {
    name: "getTimeInfoByEpoch",
    description:
      "Convert a Unix timestamp (in seconds or milliseconds) to detailed time information",
    schema: z.object({
      epoch: z.number().describe("Unix timestamp in seconds or milliseconds"),
    }),
  }
);

function parseTimeInterval(interval: string): number {
  const match = interval.match(/^(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hr|hours?)$/i);
  if (!match) {
    throw new Error(`Invalid time interval format: ${interval}`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case "s":
    case "sec":
    case "second":
    case "seconds":
      return value * 1000;
    case "m":
    case "min":
    case "minute":
    case "minutes":
      return value * 60 * 1000;
    case "h":
    case "hr":
    case "hour":
    case "hours":
      return value * 60 * 60 * 1000;
    default:
      throw new Error(`Unsupported time unit: ${unit}`);
  }
}

async function startPomodoro(interval = "25min"): Promise<void> {
  const duration = parseTimeInterval(interval);

  return new Promise((resolve) => {
    setTimeout(() => {
      new Notice(`Pomodoro timer (${interval}) completed! Take a break!`);
      resolve();
    }, duration);
  });
}

const pomodoroTool = tool(
  async ({ interval = "25min" }: { interval?: string }) => {
    startPomodoro(interval);
    return `Pomodoro timer started. It will end in ${interval}.`;
  },
  {
    name: "startPomodoro",
    description: "Start a Pomodoro timer with a customizable interval",
    schema: z.object({
      interval: z
        .string()
        .optional()
        .describe("Time interval (e.g., '25min', '5s', '1h'). Default is 25min."),
    }),
  }
);

export { getCurrentTimeTool, getTimeInfoByEpochTool, getTimeRangeMsTool, pomodoroTool };
