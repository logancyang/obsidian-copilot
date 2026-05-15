/**
 * Minimal port of LangChain's RecursiveCharacterTextSplitter — the only
 * caller (`ChunkManager`) passes explicit separators with overlap=0 and
 * keepSeparator=false, so this implementation drops the language presets,
 * keepSeparator support, and chunk-overlap-header support.
 *
 * Note: the original call site went through `fromLanguage("markdown", ...)`,
 * which silently overrode any user-supplied `separators` with the markdown
 * preset. This version honors the explicit `["\n\n", "\n", ". ", " ", ""]`
 * list the call site has always intended.
 *
 * Algorithm: for each input, pick the first separator that appears in the
 * text, split on it (dropping empty pieces, matching upstream
 * `splitOnSeparator`), recurse into any piece still over `chunkSize` using
 * the remaining separators, then greedily merge adjacent pieces back
 * together keeping each merged chunk under `chunkSize` with `chunkOverlap`
 * carryover.
 */

export interface RecursiveSplitterOptions {
  chunkSize: number;
  chunkOverlap: number;
  separators: string[];
}

export interface CreateDocumentsOptions {
  /** Prepended to each returned chunk's pageContent. */
  chunkHeader?: string;
}

export interface SplitterDocument {
  pageContent: string;
}

export class RecursiveCharacterTextSplitter {
  private chunkSize: number;
  private chunkOverlap: number;
  private separators: string[];

  constructor(options: RecursiveSplitterOptions) {
    if (options.chunkOverlap >= options.chunkSize) {
      throw new Error("chunkOverlap must be smaller than chunkSize");
    }
    this.chunkSize = options.chunkSize;
    this.chunkOverlap = options.chunkOverlap;
    this.separators = options.separators;
  }

  async createDocuments(
    texts: string[],
    _metadatas: object[] = [],
    options: CreateDocumentsOptions = {}
  ): Promise<SplitterDocument[]> {
    const header = options.chunkHeader ?? "";
    const docs: SplitterDocument[] = [];
    for (const text of texts) {
      for (const chunk of this.splitText(text)) {
        docs.push({ pageContent: header + chunk });
      }
    }
    return docs;
  }

  splitText(text: string): string[] {
    return this.recursiveSplit(text, this.separators);
  }

  private recursiveSplit(text: string, separators: string[]): string[] {
    let separator = separators[separators.length - 1] ?? "";
    let remaining: string[] = [];
    for (let i = 0; i < separators.length; i++) {
      const candidate = separators[i];
      if (candidate === "") {
        separator = "";
        remaining = [];
        break;
      }
      if (text.includes(candidate)) {
        separator = candidate;
        remaining = separators.slice(i + 1);
        break;
      }
    }

    // Match upstream `splitOnSeparator`: split, then drop empty pieces.
    const splits = text.split(separator).filter((s) => s !== "");
    const finalChunks: string[] = [];
    const goodSplits: string[] = [];

    for (const piece of splits) {
      if (piece.length < this.chunkSize) {
        goodSplits.push(piece);
        continue;
      }
      if (goodSplits.length > 0) {
        finalChunks.push(...this.mergeSplits(goodSplits, separator));
        goodSplits.length = 0;
      }
      if (remaining.length === 0) {
        finalChunks.push(piece);
      } else {
        finalChunks.push(...this.recursiveSplit(piece, remaining));
      }
    }
    if (goodSplits.length > 0) {
      finalChunks.push(...this.mergeSplits(goodSplits, separator));
    }
    return finalChunks;
  }

  private mergeSplits(splits: string[], separator: string): string[] {
    const sepLen = separator.length;
    const docs: string[] = [];
    const current: string[] = [];
    // `total` mirrors upstream: sum of item lengths, separators NOT included.
    // The "would-be joined length" is `total + current.length * sepLen` for
    // the items already in `current`, plus another `sepLen` and the new
    // item's length when considering whether to admit one more.
    let total = 0;
    for (const piece of splits) {
      const len = piece.length;
      if (total + len + current.length * sepLen > this.chunkSize) {
        if (current.length > 0) {
          const joined = this.joinDocs(current, separator);
          if (joined !== null) docs.push(joined);
          while (
            total > this.chunkOverlap ||
            (total + len + current.length * sepLen > this.chunkSize && total > 0)
          ) {
            total -= current[0].length;
            current.shift();
          }
        }
      }
      current.push(piece);
      total += len;
    }
    const tail = this.joinDocs(current, separator);
    if (tail !== null) docs.push(tail);
    return docs;
  }

  private joinDocs(docs: string[], separator: string): string | null {
    const joined = docs.join(separator).trim();
    return joined.length === 0 ? null : joined;
  }
}
