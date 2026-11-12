export interface UiFenceSegment {
  kind: "markdown" | "layout";
  source: string;
  offset: number;
  closed: boolean;
}

function normalizeFenceBody(source: string, indent: number): string {
  return source.replace(new RegExp(`^ {0,${indent}}`, "gm"), "");
}

export function splitUiFences(text: string, streaming: boolean): UiFenceSegment[] {
  const segments: UiFenceSegment[] = [];
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let fence:
    | {
        marker: string;
        length: number;
        layout: boolean;
        start: number;
        body: number;
        indent: number;
      }
    | undefined;
  let offset = 0;
  let prose = 0;
  for (const line of lines) {
    const listOpening =
      !fence && /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+(`{3,}|~{3,})([^\n]*)\n?$/.exec(line);
    const token = /^ {0,3}(`{3,}|~{3,})([^\n]*)\n?$/.exec(line) || listOpening;
    if (!fence && token) {
      // List-contained ordinary fences can contain literal layout examples. https://github.com/Brevilabs/obsidian-copilot-private/issues/883
      const layout = !listOpening && token[2].trim() === "copilot-ui";
      fence = {
        marker: token[1][0],
        length: token[1].length,
        layout,
        start: offset,
        body: offset + line.length,
        indent: /^ */.exec(line)![0].length,
      };
      if (layout && offset > prose)
        segments.push({
          kind: "markdown",
          source: text.slice(prose, offset),
          offset: prose,
          closed: true,
        });
    } else if (
      fence &&
      token &&
      token[1][0] === fence.marker &&
      token[1].length >= fence.length &&
      !token[2].trim()
    ) {
      if (fence.layout) {
        segments.push({
          kind: "layout",
          source: normalizeFenceBody(text.slice(fence.body, offset), fence.indent),
          offset: fence.start,
          closed: true,
        });
        prose = offset + line.length;
      }
      fence = undefined;
    }
    offset += line.length;
  }
  if (fence?.layout) {
    // Native Markdown removes the opening indentation before handing the body to processors. https://github.com/Brevilabs/obsidian-copilot-private/issues/883
    let body = normalizeFenceBody(text.slice(fence.body), fence.indent);
    // A closing fence itself can arrive one character at a time; it is not layout markup. https://github.com/Brevilabs/obsidian-copilot-private/issues/883
    if (streaming)
      body = body.replace(
        new RegExp(`(?:^|\\n) {0,3}\\${fence.marker}{1,${fence.length}}[ \\t]*$`),
        ""
      );
    segments.push({ kind: "layout", source: body, offset: fence.start, closed: false });
  } else if (prose < text.length) {
    segments.push({ kind: "markdown", source: text.slice(prose), offset: prose, closed: true });
  }
  return segments;
}
