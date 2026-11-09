import { useEffect, useRef, useState } from "react";

export const REVEAL_LAG_MS = 150;
export const REVEAL_COMMIT_MS = 50;
const BASE_MS_PER_UNIT = 10;
const UNSPACED = "\\u3040-\\u30ff\\u3400-\\u9fff\\uf900-\\ufaff";
const UNIT = new RegExp(`[${UNSPACED}]|[^\\s${UNSPACED}]+\\s*|\\s+`, "g");
const UNFINISHED_WORD = new RegExp(`[^\\s${UNSPACED}]+$`);

function revealLimit(text: string): number {
  return text.length - (UNFINISHED_WORD.exec(text)?.[0].length ?? 0);
}

const FENCE = /^[\t >]*(`{3,}|~{3,})(.*)$/;

// Half-written Mermaid code alternates between partial charts and parse errors on every update, so the reply jumps; show each chart only once its fence closes. https://github.com/Brevilabs/obsidian-copilot-private/issues/888
function withoutOpenDiagram(text: string): string {
  let open: { marker: string; start: number; diagram: boolean } | null = null;
  let offset = 0;
  for (const line of text.split("\n")) {
    const fence = FENCE.exec(line);
    if (fence && !open) {
      open = { marker: fence[1], start: offset, diagram: fence[2].trim() === "mermaid" };
    } else if (
      fence &&
      open &&
      fence[1][0] === open.marker[0] &&
      fence[1].length >= open.marker.length &&
      !fence[2].trim()
    ) {
      open = null;
    }
    offset += line.length + 1;
  }
  return open?.diagram ? text.slice(0, open.start) : text;
}

function advance(text: string, start: number, units: number, limit: number): number {
  const unit = new RegExp(UNIT.source, "g");
  unit.lastIndex = start;
  let end = start;
  for (let count = 0; count < units; count++) {
    const match = unit.exec(text);
    if (!match || match.index + match[0].length > limit) break;
    end = match.index + match[0].length;
  }
  return end;
}

function countUnits(text: string, start: number, limit: number): number {
  return (text.slice(start, limit).match(UNIT) ?? []).length;
}

// Models deliver replies in bursts; releasing whole words at a steady, catch-up pace reads smoothly without falling behind. https://github.com/Brevilabs/obsidian-copilot-private/issues/886
export function useSmoothedText(text: string, streaming: boolean): string {
  const [shown, setShown] = useState(text);
  const shownRef = useRef(text);
  const clock = useRef({ last: null as number | null, lastCommit: -Infinity, credit: 0 });
  const extending = streaming && text.startsWith(shown);
  useEffect(() => {
    if (!streaming || !text.startsWith(shownRef.current)) {
      shownRef.current = text;
      setShown(text);
      clock.current.last = null;
      clock.current.credit = 0;
      return;
    }
    const limit = revealLimit(text);
    const rate = Math.max(
      1 / BASE_MS_PER_UNIT,
      countUnits(text, shownRef.current.length, limit) / REVEAL_LAG_MS
    );
    let frame = 0;
    const tick = (now: number) => {
      const start = shownRef.current.length;
      const remaining = countUnits(text, start, limit);
      const pace = clock.current;
      if (remaining === 0) {
        pace.last = null;
        pace.credit = 0;
        return;
      }
      pace.credit += (now - (pace.last ?? now - 16)) * rate;
      pace.last = now;
      const units = Math.floor(pace.credit);
      if (units > 0 && (now - pace.lastCommit >= REVEAL_COMMIT_MS || units >= remaining)) {
        pace.credit -= units;
        pace.lastCommit = now;
        shownRef.current = text.slice(0, advance(text, start, units, limit));
        setShown(shownRef.current);
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [text, streaming]);
  return streaming ? withoutOpenDiagram(extending ? shown : text) : text;
}
