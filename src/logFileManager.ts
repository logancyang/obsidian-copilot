import { err2String } from "@/errorFormat";
import { TFile } from "obsidian";

type LogLevel = "INFO" | "WARN" | "ERROR";

/**
 * Manages a rolling log file that keeps the last N entries and works on desktop and mobile.
 * - Writes to <vault>/copilot-log.md
 * - Maintains an in-memory ring buffer of the last 1000 entries
 * - Debounced flush to reduce I/O; single-line entries to preserve accurate line limits
 */
class LogFileManager {
  private static instance: LogFileManager;

  private readonly maxLines = 1000;
  private readonly debounceMs = 1500; // per user preference
  private readonly maxLineChars = 8000; // guard against extremely large entries
  private buffer: string[] = [];
  private initialized = false;
  private flushing = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  static getInstance(): LogFileManager {
    if (!LogFileManager.instance) {
      LogFileManager.instance = new LogFileManager();
    }
    return LogFileManager.instance;
  }

  getLogPath(): string {
    return "copilot-log.md"; // vault root
  }

  /** Ensure buffer is loaded with up to last 1000 lines from existing file. */
  private async ensureInitialized() {
    if (this.initialized) return;
    try {
      if (!this.hasVault()) {
        this.initialized = true;
        return;
      }
      const path = this.getLogPath();
      const exists = await app.vault.adapter.exists(path);
      if (exists) {
        const content = await app.vault.adapter.read(path);
        // Normalize line endings and split
        const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
        if (lines.length > this.maxLines) {
          this.buffer = lines.slice(lines.length - this.maxLines);
        } else {
          this.buffer = lines;
        }
      }
    } catch {
      // Ignore read errors; start fresh
      this.buffer = [];
    } finally {
      this.initialized = true;
    }
  }

  private hasVault(): boolean {
    // global `app` is available in Obsidian environment
    try {
      return typeof app !== "undefined" && !!app.vault?.adapter;
    } catch {
      return false;
    }
  }

  private sanitizeForSingleLine(value: unknown): string {
    // Error handling: include stack traces by default as requested, collapsed to one line
    if (value instanceof Error) {
      const withStack = err2String(value, true);
      return this.escapeAngleBrackets(this.collapseToSingleLine(withStack));
    }

    if (typeof value === "string") {
      return this.escapeAngleBrackets(this.collapseToSingleLine(value));
    }

    // JSON stringify without spacing; fall back to String()
    try {
      const json = JSON.stringify(value);
      return this.escapeAngleBrackets(this.collapseToSingleLine(json ?? String(value)));
    } catch {
      return this.escapeAngleBrackets(this.collapseToSingleLine(String(value)));
    }
  }

  private collapseToSingleLine(s: string): string {
    // Replace CR/LF and tabs to keep a single physical line in the log file
    const oneLine = s.replace(/[\r\n]+/g, "\\n").replace(/\t/g, " ");
    if (oneLine.length <= this.maxLineChars) return oneLine;
    return (
      oneLine.slice(0, this.maxLineChars) +
      ` … [truncated ${oneLine.length - this.maxLineChars} chars]`
    );
  }

  async append(level: LogLevel, ...args: unknown[]) {
    await this.ensureInitialized();

    const ts = new Date().toISOString();
    const parts = args.map((a) => this.sanitizeForSingleLine(a));
    const line = `${ts} ${level} ${parts.join(" ")}`.trim();

    this.buffer.push(line);
    if (this.buffer.length > this.maxLines) {
      this.buffer.splice(0, this.buffer.length - this.maxLines);
    }

    this.scheduleFlush();
  }

  /**
   * Escape angle brackets to prevent Markdown/HTML rendering from interfering with the log note.
   */
  private escapeAngleBrackets(s: string): string {
    return s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /**
   * Append a raw Markdown block as multiple physical lines without timestamps or sanitization.
   * Useful for structures that rely on line starts (e.g., tables, code fences).
   */
  async appendMarkdownBlock(lines: string[]): Promise<void> {
    await this.ensureInitialized();

    if (!Array.isArray(lines) || lines.length === 0) return;

    // Add each line as-is to preserve Markdown semantics
    for (const line of lines) {
      const s = typeof line === "string" ? line : String(line ?? "");
      this.buffer.push(s);
      if (this.buffer.length > this.maxLines) {
        this.buffer.splice(0, this.buffer.length - this.maxLines);
      }
    }

    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (!this.hasVault()) return; // no-op in tests or non-Obsidian env
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.debounceMs);
  }

  async flush(): Promise<void> {
    if (!this.hasVault()) return;
    if (this.flushing) return;
    this.flushing = true;
    try {
      const path = this.getLogPath();
      const content = this.buffer.join("\n") + (this.buffer.length ? "\n" : "");
      await app.vault.adapter.write(path, content);
    } catch {
      // swallow write errors; logging should never crash the app
    } finally {
      this.flushing = false;
    }
  }

  async clear(): Promise<void> {
    this.buffer = [];
    if (!this.hasVault()) return;
    try {
      const path = this.getLogPath();
      if (await app.vault.adapter.exists(path)) {
        await app.vault.adapter.write(path, "");
      }
    } catch {
      // ignore
    }
  }

  async openLogFile(): Promise<void> {
    await this.flush();
    if (!this.hasVault()) return;
    const path = this.getLogPath();
    let file = app.vault.getAbstractFileByPath(path) as TFile | null;
    try {
      if (!file) {
        // Create file if missing so it can be opened
        file = await app.vault.create(
          path,
          this.buffer.join("\n") + (this.buffer.length ? "\n" : "")
        );
      }
      const leaf = app.workspace.getLeaf(true);
      await leaf.openFile(file);
    } catch {
      // ignore
    }
  }
}

export const logFileManager = LogFileManager.getInstance();
