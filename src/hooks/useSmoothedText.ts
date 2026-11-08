import { useEffect, useRef, useState } from "react";

export const REVEAL_LAG_MS = 150;
export const REVEAL_COMMIT_MS = 50;
const BASE_MS_PER_UNIT = 10;
const UNSPACED = "\\u3040-\\u30ff\\u3400-\\u9fff\\uac00-\\ud7af\\uf900-\\ufaff";
const UNIT = new RegExp(`[${UNSPACED}]|[^\\s${UNSPACED}]+\\s*|\\s+`, "g");
const UNFINISHED_WORD = new RegExp(`[^\\s${UNSPACED}]+$`);

function revealLimit(text: string): number {
  return text.length - (UNFINISHED_WORD.exec(text)?.[0].length ?? 0);
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
  const extending = streaming && text.startsWith(shown);
  useEffect(() => {
    if (!streaming || !text.startsWith(shownRef.current)) {
      shownRef.current = text;
      setShown(text);
      return;
    }
    const limit = revealLimit(text);
    const rate = Math.max(
      1 / BASE_MS_PER_UNIT,
      countUnits(text, shownRef.current.length, limit) / REVEAL_LAG_MS
    );
    let frame = 0;
    let last: number | null = null;
    let lastCommit = -Infinity;
    let credit = 0;
    const tick = (now: number) => {
      const start = shownRef.current.length;
      const remaining = countUnits(text, start, limit);
      if (remaining === 0) return;
      credit += (now - (last ?? now - 16)) * rate;
      last = now;
      const units = Math.floor(credit);
      if (units > 0 && (now - lastCommit >= REVEAL_COMMIT_MS || units >= remaining)) {
        credit -= units;
        lastCommit = now;
        shownRef.current = text.slice(0, advance(text, start, units, limit));
        setShown(shownRef.current);
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [text, streaming]);
  return extending ? shown : text;
}
