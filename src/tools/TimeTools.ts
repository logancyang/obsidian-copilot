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

function getTimeRangeMs(timeExpression: string): { startTime: TimeInfo; endTime: TimeInfo } {
  const now = DateTime.now();
  let start: DateTime;
  let end: DateTime;

  // First, try to parse common expressions
  switch (timeExpression.toLowerCase()) {
    case "yesterday":
      start = now.minus({ days: 1 }).startOf("day");
      end = now.minus({ days: 1 }).endOf("day");
      break;
    case "last week":
      start = now.minus({ weeks: 1 }).startOf("week");
      end = now.minus({ weeks: 1 }).endOf("week");
      break;
    case "this week":
      start = now.startOf("week");
      end = now.endOf("week");
      break;
    case "next week":
      start = now.plus({ weeks: 1 }).startOf("week");
      end = now.plus({ weeks: 1 }).endOf("week");
      break;
    case "last month":
      start = now.minus({ months: 1 }).startOf("month");
      end = now.minus({ months: 1 }).endOf("month");
      break;
    case "this month":
      start = now.startOf("month");
      end = now.endOf("month");
      break;
    case "next month":
      start = now.plus({ months: 1 }).startOf("month");
      end = now.plus({ months: 1 }).endOf("month");
      break;
    case "last year":
      start = now.minus({ years: 1 }).startOf("year");
      end = now.minus({ years: 1 }).endOf("year");
      break;
    case "this year":
      start = now.startOf("year");
      end = now.endOf("year");
      break;
    case "next year":
      start = now.plus({ years: 1 }).startOf("year");
      end = now.plus({ years: 1 }).endOf("year");
      break;
    default: {
      // Use Chrono.js for more complex expressions
      const parsedDates = chrono.parse(timeExpression, now.toJSDate(), { forwardDate: false });
      if (parsedDates.length > 0) {
        start = DateTime.fromJSDate(parsedDates[0].start.date());
        end = parsedDates[0].end
          ? DateTime.fromJSDate(parsedDates[0].end.date())
          : start.endOf("month"); // Default to end of month if no end date is specified

        // If the parsed date is in the future, adjust it to the previous occurrence
        if (start > now) {
          start = start.minus({ years: 1 });
          end = end.minus({ years: 1 });
        }
      } else {
        throw new Error(`Unable to parse time expression: ${timeExpression}`);
      }
      break;
    }
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
