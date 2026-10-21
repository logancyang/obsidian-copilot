import { requireNodeModule } from "@/utils/desktopRuntime";

export interface TaskOutputReader {
  size(path: string): Promise<number | null>;
  read(path: string, start: number, length: number): Promise<Uint8Array>;
}

export interface TaskOutputSnapshot {
  text: string;
  truncated: boolean;
}

export const EMPTY_TASK_OUTPUT: TaskOutputSnapshot = Object.freeze({ text: "", truncated: false });

export function createNodeTaskOutputReader(): TaskOutputReader {
  const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
  return {
    size: async (path) => {
      try {
        return (await fs.stat(path)).size;
      } catch {
        return null;
      }
    },
    read: async (path, start, length) => {
      const handle = await fs.open(path, "r");
      try {
        const buffer = new Uint8Array(length);
        const { bytesRead } = await handle.read(buffer, 0, length, start);
        return buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    },
  };
}

export function lastOutputLine(text: string): string {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.length > 0) return line;
  }
  return "";
}

function dropPartialFirstLine(text: string): string {
  const newline = text.indexOf("\n");
  const rest = newline === -1 ? text : text.slice(newline + 1);
  // A single line longer than the cap would otherwise leave no output to show. https://github.com/Brevilabs/obsidian-copilot-private/issues/749
  return rest.trim().length > 0 ? rest : text;
}

// A command's output can grow without bound, so only its newest bytes are read and kept. https://github.com/Brevilabs/obsidian-copilot-private/issues/749
export class TaskOutputTail {
  private offset = 0;
  private decoder = new TextDecoder();
  private snapshot: TaskOutputSnapshot = EMPTY_TASK_OUTPUT;

  constructor(
    private readonly path: string,
    private readonly maxBytes: number,
    private readonly reader: TaskOutputReader
  ) {}

  async poll(): Promise<TaskOutputSnapshot> {
    const size = await this.reader.size(this.path);
    if (size === null) return this.snapshot;
    if (size < this.offset) this.reset();
    if (size === this.offset) return this.snapshot;
    const start = Math.max(this.offset, size - this.maxBytes);
    const skipped = start > this.offset;
    const bytes = await this.reader.read(this.path, start, size - start);
    this.offset = start + bytes.length;
    if (skipped) this.decoder = new TextDecoder();
    const chunk = this.decoder.decode(bytes, { stream: true });
    let text = (skipped ? "" : this.snapshot.text) + chunk;
    let cut = skipped;
    if (text.length > this.maxBytes) {
      text = text.slice(text.length - this.maxBytes);
      cut = true;
    }
    this.snapshot = {
      text: cut ? dropPartialFirstLine(text) : text,
      truncated: this.snapshot.truncated || cut,
    };
    return this.snapshot;
  }

  private reset(): void {
    this.offset = 0;
    this.decoder = new TextDecoder();
    this.snapshot = EMPTY_TASK_OUTPUT;
  }
}
