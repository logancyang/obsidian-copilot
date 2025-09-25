import * as chrono from "chrono-node";
import { DateTime } from "luxon";
import { z } from "zod";
import { createTool } from "./SimpleTool";

export interface TimeInfo {
  epoch: number;
  isoString: string;
  userLocaleString: string;
  localDateString: string;
  timezoneOffset: number;
  timezone: string;
}

/**
 * Parse timezone offset string to a valid UTC offset
 * Supports formats like: "+8", "-5", "+08:00", "-05:30", "UTC+8", "GMT-5"
 * Returns a normalized UTC offset string like "UTC+8" or "UTC-5:30"
 */
function parseTimezoneOffset(offset: string): string {
  // Extract the numeric offset from various formats
  const offsetMatch = offset.match(/^(?:UTC|GMT)?([-+]?\d{1,2})(?::(\d{2}))?$/i);
  if (!offsetMatch) {
    throw new Error(
      `Invalid timezone offset format: ${offset}. Use formats like '+8', '-5', '+5:30', 'UTC+8', 'GMT-5'`
    );
  }

  const hours = parseInt(offsetMatch[1]);
  const minutes = parseInt(offsetMatch[2] || "0");

  // Validate the offset range
  if (Math.abs(hours) > 14 || minutes >= 60) {
    throw new Error(
      `Invalid timezone offset: ${offset}. Hours must be between -14 and +14, minutes must be less than 60`
    );
  }

  // Create a normalized UTC offset string
  const sign = hours >= 0 ? "+" : "";
  const minutesStr = minutes > 0 ? `:${minutes.toString().padStart(2, "0")}` : "";

  return `UTC${sign}${hours}${minutesStr}`;
}

async function getCurrentTime(timezoneOffset?: string): Promise<TimeInfo> {
  let dt: DateTime = DateTime.now();

  // If timezone offset is provided, convert to that timezone
  if (timezoneOffset) {
    try {
      const parsedOffset = parseTimezoneOffset(timezoneOffset);
      const newDt = dt.setZone(parsedOffset);
      if (!newDt.isValid) {
        throw new Error(`Failed to apply timezone offset: ${timezoneOffset}`);
      }
      dt = newDt;
    } catch (error) {
      throw new Error(`${error.message}`);
    }
  }

  const jsDate = dt.toJSDate();
  // Use Luxon's offset which is in minutes and already has the correct sign
  const offsetMinutes = dt.offset;
  const timezoneAbbr = dt.offsetNameShort || "Unknown";

  return {
    epoch: Math.floor(jsDate.getTime()),
    isoString: jsDate.toISOString(),
    userLocaleString: dt.toLocaleString(DateTime.DATETIME_FULL),
    localDateString: dt.toISODate() || "",
    timezoneOffset: offsetMinutes,
    timezone: timezoneAbbr,
  };
}

const getCurrentTimeTool = createTool({
  name: "getCurrentTime",
  description:
    "Get the current time in local timezone or at a specified UTC offset. Returns epoch time, ISO string, and formatted strings.",
  schema: z.object({
    timezoneOffset: z
      .string()
      .optional()
      .describe(
        `Optional UTC offset. IMPORTANT: Must be a numeric offset, NOT a timezone name.

EXAMPLES OF CORRECT USAGE:
- "what time is it" → No parameter (uses local time)
- "what time is it in Tokyo" → timezoneOffset: "+9"
- "what time is it in Beijing" → timezoneOffset: "+8"
- "what time is it in New York" → timezoneOffset: "-5" (or "-4" during DST)
- "what time is it in Mumbai" → timezoneOffset: "+5:30"

SUPPORTED FORMATS:
- Simple: "+8", "-5", "+5:30"
- With prefix: "UTC+8", "GMT-5", "UTC+5:30"

COMMON TIMEZONE OFFSETS:
- Tokyo: UTC+9
- Beijing/Singapore: UTC+8
- Mumbai: UTC+5:30
- Dubai: UTC+4
- London: UTC+0 (UTC+1 during BST)
- New York: UTC-5 (UTC-4 during DST)
- Los Angeles: UTC-8 (UTC-7 during DST)`
      ),
  }),
  handler: async ({ timezoneOffset }) => getCurrentTime(timezoneOffset),
  isBackground: true,
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
 * - "last quarter", "this quarter", "next quarter"
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
    case "this week":
      return {
        start: now.startOf("week"),
        end: now.endOf("week"),
      };
    case "next week":
      return {
        start: now.plus({ weeks: 1 }).startOf("week"),
        end: now.plus({ weeks: 1 }).endOf("week"),
      };
    case "last month":
      return {
        start: now.minus({ months: 1 }).startOf("month"),
        end: now.minus({ months: 1 }).endOf("month"),
      };
    case "this month":
      return {
        start: now.startOf("month"),
        end: now.endOf("month"),
      };
    case "next month":
      return {
        start: now.plus({ months: 1 }).startOf("month"),
        end: now.plus({ months: 1 }).endOf("month"),
      };
    case "last year":
      return {
        start: now.minus({ years: 1 }).startOf("year"),
        end: now.minus({ years: 1 }).endOf("year"),
      };
    case "this year":
      return {
        start: now.startOf("year"),
        end: now.endOf("year"),
      };
    case "next year":
      return {
        start: now.plus({ years: 1 }).startOf("year"),
        end: now.plus({ years: 1 }).endOf("year"),
      };
    case "last quarter":
      return {
        start: now.minus({ quarters: 1 }).startOf("quarter"),
        end: now.minus({ quarters: 1 }).endOf("quarter"),
      };
    case "this quarter":
      return {
        start: now.startOf("quarter"),
        end: now.endOf("quarter"),
      };
    case "next quarter":
      return {
        start: now.plus({ quarters: 1 }).startOf("quarter"),
        end: now.plus({ quarters: 1 }).endOf("quarter"),
      };
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

/**
 * Handles quarter patterns like:
 * - "Q1 2024", "2024 Q1"
 * - "q2 2023", "2023 q2"
 * - Q1, q1 (current year)
 */
function handleQuarter(input: string, now: DateTime) {
  // First try matching full quarter with year pattern
  const quarterYearMatch = input.match(/^(?:(?:q|Q)(\d{1})\s+(\d{4})|(\d{4})\s+(?:q|Q)(\d{1}))$/);

  // Then try matching just the quarter pattern
  const quarterOnlyMatch = input.match(/^(?:q|Q)(\d{1})$/);

  let quarter: number;
  let year: number;

  if (quarterYearMatch) {
    // Extract quarter and year whether it's "Q1 2024" or "2024 Q1" format
    quarter = parseInt(quarterYearMatch[1] || quarterYearMatch[4]);
    year = parseInt(quarterYearMatch[2] || quarterYearMatch[3]);
  } else if (quarterOnlyMatch) {
    quarter = parseInt(quarterOnlyMatch[1]);
    year = now.year;

    // Adjust year if the quarter is in the future
    const currentQuarter = Math.floor((now.month - 1) / 3) + 1;
    if (quarter > currentQuarter) {
      year--;
    }
  } else {
    return undefined;
  }

  // Validate quarter number
  if (quarter < 1 || quarter > 4) return undefined;

  // Calculate start and end months for the quarter
  const startMonth = (quarter - 1) * 3 + 1; // Q1=1, Q2=4, Q3=7, Q4=10

  let start = DateTime.fromObject({
    year,
    month: startMonth,
    day: 1,
  }).startOf("day");

  let end = start.plus({ months: 3 }).minus({ days: 1 }).endOf("day");

  // Adjust if dates are in the future
  if (start > now) {
    start = start.minus({ years: 1 });
    end = end.minus({ years: 1 });
  }

  return { start, end };
}

/**
 * Handles month-year combinations like:
 * - "jan 2024", "january 2024"
 * - "dec 2023", "december 2023"
 */
function handleMonthYear(input: string, now: DateTime) {
  const monthYearMatch = input.match(
    /^(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|september|oct|october|nov|november|dec|december)\s+(\d{4})$/i
  );
  if (!monthYearMatch) return undefined;

  const monthNum = monthNames[monthYearMatch[1].toLowerCase() as keyof typeof monthNames];
  const year = parseInt(monthYearMatch[2]);

  let start = DateTime.fromObject({
    year,
    month: monthNum,
    day: 1,
  }).startOf("day");

  let end = start.endOf("month");

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
    handleMonthYear(normalizedInput, now) ||
    handleQuarter(normalizedInput, now) ||
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
  // Use Luxon's offset which is in minutes and already has the correct sign
  const offsetMinutes = dateTime.offset;
  const timezoneAbbr = dateTime.offsetNameShort || "Unknown";

  return {
    epoch: Math.floor(jsDate.getTime()),
    isoString: jsDate.toISOString(),
    userLocaleString: dateTime.toLocaleString(DateTime.DATETIME_FULL),
    localDateString: dateTime.toISODate() || "",
    timezoneOffset: offsetMinutes,
    timezone: timezoneAbbr,
  };
}

const getTimeRangeMsTool = createTool({
  name: "getTimeRangeMs",
  description: "Convert natural language time expressions to date ranges for use with localSearch",
  schema: z.object({
    timeExpression: z.string()
      .describe(`Natural language time expression to convert to a date range.

COMMON EXPRESSIONS:
- Relative past: "yesterday", "last week", "last month", "last year"
- Relative ranges: "this week", "this month", "this year"
- Specific dates: "July 1", "July 1 2023", "2023-07-01"
- Date ranges: "from July 1 to July 15", "between May and June"
- Time periods: "last 7 days", "past 30 days", "previous 3 months"

IMPORTANT: This tool is typically used as the first step before localSearch when searching notes by time.

EXAMPLE WORKFLOW:
1. User: "what did I do last week"
2. First call getTimeRangeMs with timeExpression: "last week"
3. Then use the returned time range with localSearch`),
  }),
  handler: async ({ timeExpression }) => getTimeRangeMs(timeExpression),
  isBackground: true,
});

function getTimeInfoByEpoch(epoch: number): TimeInfo {
  // Check if the epoch is in seconds (10 digits) or milliseconds (13 digits)
  const epochMs = epoch.toString().length === 10 ? epoch * 1000 : epoch;
  const dateTime = DateTime.fromMillis(epochMs);
  return convertToTimeInfo(dateTime);
}

const getTimeInfoByEpochTool = createTool({
  name: "getTimeInfoByEpoch",
  description: "Convert a Unix timestamp (in seconds or milliseconds) to detailed time information",
  schema: z.object({
    epoch: z.number().describe("Unix timestamp in seconds or milliseconds"),
  }),
  handler: async ({ epoch }) => getTimeInfoByEpoch(epoch),
  isBackground: true,
});

/**
 * Convert a time from one UTC offset to another
 * @param time - Time expression like "6pm", "18:00", "3:30 PM"
 * @param fromOffset - Source UTC offset (e.g., "+8", "-5", "UTC+8")
 * @param toOffset - Target UTC offset (e.g., "+9", "-5", "UTC+9")
 * @returns Time information in the target timezone
 */
async function convertTimeBetweenTimezones(
  time: string,
  fromOffset: string,
  toOffset: string
): Promise<TimeInfo & { originalTime: string; convertedTime: string }> {
  // Parse timezone offsets
  const sourceTz = parseTimezoneOffset(fromOffset);
  const targetTz = parseTimezoneOffset(toOffset);

  try {
    // Parse the time string using chrono
    const baseDate = DateTime.now().setZone(sourceTz);
    const parsedDate = chrono.parseDate(time, baseDate.toJSDate());

    if (!parsedDate) {
      throw new Error(`Could not parse time: ${time}`);
    }

    // Create DateTime interpreting the parsed date as already being in source timezone
    const sourceDt = DateTime.fromJSDate(parsedDate, { zone: sourceTz });

    // Convert to target timezone
    const targetDt = sourceDt.setZone(targetTz);

    if (!targetDt.isValid) {
      throw new Error(`Invalid timezone conversion`);
    }

    const jsDate = targetDt.toJSDate();
    // Use Luxon's offset which is in minutes and already has the correct sign
    const offsetMinutes = targetDt.offset;

    return {
      epoch: Math.floor(jsDate.getTime()),
      isoString: jsDate.toISOString(),
      userLocaleString: targetDt.toLocaleString(DateTime.DATETIME_FULL),
      localDateString: targetDt.toISODate() || "",
      timezoneOffset: offsetMinutes,
      timezone: targetDt.offsetNameShort || targetTz,
      originalTime: sourceDt.toLocaleString(DateTime.TIME_SIMPLE) + " " + sourceDt.offsetNameShort,
      convertedTime: targetDt.toLocaleString(DateTime.TIME_SIMPLE) + " " + targetDt.offsetNameShort,
    };
  } catch (error) {
    throw new Error(`Failed to convert time: ${error.message}`);
  }
}

const convertTimeBetweenTimezonesTool = createTool({
  name: "convertTimeBetweenTimezones",
  description: "Convert a specific time from one timezone to another using UTC offsets",
  schema: z.object({
    time: z.string().describe(`Time to convert. Supports various formats:
- 12-hour: "6pm", "3:30 PM", "11:45 am"
- 24-hour: "18:00", "15:30", "23:45"
- Relative: "noon", "midnight"`),
    fromOffset: z.string().describe(`Source UTC offset. Must be numeric, not timezone name.
Examples: "-8" for PT, "+0" for London, "+8" for Beijing`),
    toOffset: z.string().describe(`Target UTC offset. Must be numeric, not timezone name.
Examples: "+9" for Tokyo, "-5" for NY, "+5:30" for Mumbai

EXAMPLE USAGE:
- "what time is 6pm PT in Tokyo" → time: "6pm", fromOffset: "-8", toOffset: "+9"
- "convert 3:30 PM EST to London time" → time: "3:30 PM", fromOffset: "-5", toOffset: "+0"
- "what is 9am Beijing time in New York" → time: "9am", fromOffset: "+8", toOffset: "-5"`),
  }),
  handler: async ({ time, fromOffset, toOffset }) =>
    convertTimeBetweenTimezones(time, fromOffset, toOffset),
  isBackground: true,
});

export {
  getCurrentTimeTool,
  getTimeInfoByEpochTool,
  getTimeRangeMsTool,
  convertTimeBetweenTimezonesTool,
};
