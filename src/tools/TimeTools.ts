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

function getTimeRangeMs(timeExpression: string):
  | {
      startTime: TimeInfo;
      endTime: TimeInfo;
    }
  | undefined {
  const now = DateTime.now();
  let start: DateTime;
  let end: DateTime;

  const normalizedInput = timeExpression.toLowerCase().replace("@vault", "").trim();

  // Handle special cases first
  switch (normalizedInput) {
    case "yesterday":
      start = now.minus({ days: 1 }).startOf("day");
      end = now.minus({ days: 1 }).endOf("day");
      return {
        startTime: convertToTimeInfo(start),
        endTime: convertToTimeInfo(end),
      };
    case "last week":
      start = now.minus({ weeks: 1 }).startOf("week");
      end = now.minus({ weeks: 1 }).endOf("week");
      return {
        startTime: convertToTimeInfo(start),
        endTime: convertToTimeInfo(end),
      };
    case "this week":
      start = now.startOf("week");
      end = now.endOf("week");
      return {
        startTime: convertToTimeInfo(start),
        endTime: convertToTimeInfo(end),
      };
    case "next week":
      start = now.plus({ weeks: 1 }).startOf("week");
      end = now.plus({ weeks: 1 }).endOf("week");
      return {
        startTime: convertToTimeInfo(start),
        endTime: convertToTimeInfo(end),
      };
    case "last month":
      start = now.minus({ months: 1 }).startOf("month");
      end = now.minus({ months: 1 }).endOf("month");
      return {
        startTime: convertToTimeInfo(start),
        endTime: convertToTimeInfo(end),
      };
    case "this month":
      start = now.startOf("month");
      end = now.endOf("month");
      return {
        startTime: convertToTimeInfo(start),
        endTime: convertToTimeInfo(end),
      };
    case "next month":
      start = now.plus({ months: 1 }).startOf("month");
      end = now.plus({ months: 1 }).endOf("month");
      return {
        startTime: convertToTimeInfo(start),
        endTime: convertToTimeInfo(end),
      };
    case "last year":
      start = now.minus({ years: 1 }).startOf("year");
      end = now.minus({ years: 1 }).endOf("year");
      return {
        startTime: convertToTimeInfo(start),
        endTime: convertToTimeInfo(end),
      };
    case "this year":
      start = now.startOf("year");
      end = now.endOf("year");
      return {
        startTime: convertToTimeInfo(start),
        endTime: convertToTimeInfo(end),
      };
    case "next year":
      start = now.plus({ years: 1 }).startOf("year");
      end = now.plus({ years: 1 }).endOf("year");
      return {
        startTime: convertToTimeInfo(start),
        endTime: convertToTimeInfo(end),
      };
  }

  // Check for "week of" pattern first
  const weekOfMatch = normalizedInput.match(/(?:the\s+)?week\s+of\s+(.+)/i);
  if (weekOfMatch) {
    const dateStr = weekOfMatch[1];
    const parsedDates = chrono.parse(dateStr, now.toJSDate(), { forwardDate: false });
    if (parsedDates.length > 0) {
      start = DateTime.fromJSDate(parsedDates[0].start.date()).startOf("week");
      end = start.endOf("week");

      if (start > now) {
        start = start.minus({ years: 1 });
        end = end.minus({ years: 1 });
      }

      return {
        startTime: convertToTimeInfo(start),
        endTime: convertToTimeInfo(end),
      };
    }
  }

  // Check if input is just a month name
  const monthMatch = normalizedInput.match(
    /^(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|september|oct|october|nov|november|dec|december)$/i
  );
  if (monthMatch) {
    const monthNum = monthNames[monthMatch[1] as keyof typeof monthNames];
    let year = now.year;

    // If the month is in the future, use last year
    if (monthNum > now.month) {
      year--;
    }

    // Create start and end dates for the entire month
    start = DateTime.fromObject({
      year,
      month: monthNum,
      day: 1,
    });

    end = start.endOf("month");

    if (start > now) {
      start = start.minus({ years: 1 });
      end = end.minus({ years: 1 });
    }

    if (start > end) {
      [start, end] = [end, start];
    }

    return {
      startTime: convertToTimeInfo(start),
      endTime: convertToTimeInfo(end),
    };
  }

  // Use Chrono.js for parsing dates
  timeExpression = timeExpression.replace("@vault", "");
  const parsedDates = chrono.parse(timeExpression, now.toJSDate(), { forwardDate: false });
  if (parsedDates.length > 0) {
    // Convert to DateTime while preserving the local timezone
    start = DateTime.fromJSDate(parsedDates[0].start.date()).startOf("day");

    // If no end date is specified, use the same day as end date
    end = parsedDates[0].end
      ? DateTime.fromJSDate(parsedDates[0].end.date()).endOf("day")
      : start.endOf("day");

    // If the parsed date is in the future, adjust it to the previous occurrence
    if (start > now) {
      start = start.minus({ years: 1 });
      end = end.minus({ years: 1 });
    }
  } else {
    console.warn(`Unable to parse time expression: ${timeExpression}`);
    return;
  }

  return {
    startTime: convertToTimeInfo(start),
    endTime: convertToTimeInfo(end),
  };
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
