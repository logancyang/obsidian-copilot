import type { App } from "obsidian";

export type RecordedSection = readonly [type: string, startLine: number, endLine: number];

export type RecordedListItem = readonly [startLine: number, endLine: number, parent: number];

export interface RecordedParse {
  sections: readonly RecordedSection[];
  listItems?: readonly RecordedListItem[];
}

export type RecordedParser = (source: string) => RecordedParse | Promise<RecordedParse>;

export function appParsing(parse: RecordedParse | RecordedParser): App {
  const computeMetadataAsync = jest.fn(async (buffer: ArrayBuffer) => {
    const source = new TextDecoder().decode(buffer);
    const recorded = typeof parse === "function" ? await parse(source) : parse;
    const lines = source.split("\n");
    const offsetOf = (line: number, column: number): number =>
      Math.min(
        lines.slice(0, line).reduce((total, text) => total + text.length + 1, 0) + column,
        source.length
      );
    const span = (startLine: number, endLine: number) => ({
      start: { line: startLine, col: 0, offset: offsetOf(startLine, 0) },
      end: {
        line: endLine,
        col: (lines[endLine] ?? "").length,
        offset: offsetOf(endLine, (lines[endLine] ?? "").length),
      },
    });
    return {
      sections: recorded.sections.map(([type, start, end]) => ({
        type,
        position: span(start, end),
      })),
      listItems: (recorded.listItems ?? []).map(([start, end, parent]) => ({
        parent,
        position: span(start, end),
      })),
    };
  });
  return { metadataCache: { computeMetadataAsync } } as unknown as App;
}
