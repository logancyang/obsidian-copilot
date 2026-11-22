import { RECORDED_PARSES } from "@/agentMode/ui/renderedDiff/testing/fixtures";
import {
  appParsing,
  type RecordedParse,
} from "@/agentMode/ui/renderedDiff/testing/recordedParserApp";
import type { App } from "obsidian";

export interface HeldParse {
  source: string;
  until: Promise<void>;
}

function recordedParsesBySource(): Map<string, RecordedParse> {
  const bySource = new Map<string, RecordedParse>();
  for (const [fixture, parses] of RECORDED_PARSES) {
    bySource.set((fixture.before ?? "").replace(/\r\n/g, "\n"), parses.before);
    bySource.set((fixture.after ?? "").replace(/\r\n/g, "\n"), parses.after);
  }
  return bySource;
}

export function appParsingRecordedFixtures(held?: HeldParse): App {
  const bySource = recordedParsesBySource();
  return appParsing(async (source) => {
    if (source === held?.source) await held.until;
    const parse = bySource.get(source);
    if (parse === undefined) throw new Error(`No recorded parse for: ${source}`);
    return parse;
  });
}
