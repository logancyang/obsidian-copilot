import { err2String } from "@/errorFormat";
import { App, TFile } from "obsidian";
import { ensureFolderExists } from "@/utils";
import { getSettings } from "@/settings/model";
import { getEffectiveCopilotFolder } from "@/settings/copilotFolder";
import { isSensitiveKey } from "@/services/settingsSecretTransforms";

type LogLevel = "INFO" | "WARN" | "ERROR";

class LogFileManager {
  private static instance: LogFileManager;

  private readonly maxLines = 500;
  private readonly maxLineChars = 8000;
  private buffer: string[] = [];
  private initialized = false;
  private flushing = false;
  private app: App | null = null;

  static getInstance(): LogFileManager {
    if (!LogFileManager.instance) {
      LogFileManager.instance = new LogFileManager();
    }
    return LogFileManager.instance;
  }

  setApp(app: App): void {
    this.app = app;
  }

  getLogPath(): string {
    return `${getEffectiveCopilotFolder()}/copilot-log.md`;
  }

  private async ensureInitialized() {
    if (this.initialized) return;
    this.initialized = true;
  }

  private sanitizeForSingleLine(value: unknown): string {
    if (value instanceof Error) {
      const withStack = err2String(value, true);
      return this.escapeAngleBrackets(this.collapseToSingleLine(withStack));
    }

    if (typeof value === "string") {
      return this.escapeAngleBrackets(this.collapseToSingleLine(value));
    }

    try {
      const json = JSON.stringify(value);
      return this.escapeAngleBrackets(this.collapseToSingleLine(json ?? String(value)));
    } catch {
      return this.escapeAngleBrackets(this.collapseToSingleLine(String(value)));
    }
  }

  private collapseToSingleLine(s: string): string {
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
  }

  private escapeAngleBrackets(s: string): string {
    return s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  async appendMarkdownBlock(lines: string[]): Promise<void> {
    await this.ensureInitialized();

    if (!Array.isArray(lines) || lines.length === 0) return;

    for (const line of lines) {
      const s = typeof line === "string" ? line : String(line ?? "");
      this.buffer.push(s);
      if (this.buffer.length > this.maxLines) {
        this.buffer.splice(0, this.buffer.length - this.maxLines);
      }
    }
  }

  exportLogText(): string {
    if (this.buffer.length === 0) return "";
    return this.buffer.join("\n") + "\n";
  }

  async flush(): Promise<void> {
    const app = this.app;
    if (!app?.vault?.adapter) return;
    if (this.flushing) return;
    this.flushing = true;
    try {
      const path = this.getLogPath();
      if (await app.vault.adapter.exists(path)) {
        const content = this.buffer.join("\n") + (this.buffer.length ? "\n" : "");
        await app.vault.adapter.write(path, content);
      }
    } catch {
      // swallow write errors; logging should never crash the app
    } finally {
      this.flushing = false;
    }
  }

  async clear(): Promise<void> {
    this.buffer = [];
    const app = this.app;
    if (!app?.vault?.adapter) return;
    try {
      const path = this.getLogPath();
      if (await app.vault.adapter.exists(path)) {
        await app.vault.adapter.remove(path);
      }
    } catch {
      // ignore
    }
  }

  private sanitizeSettingsForLog(): Record<string, unknown> {
    const settings = getSettings();
    return this.removeKeysRecursive(settings) as Record<string, unknown>;
  }

  private removeKeysRecursive(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.removeKeysRecursive(item));
    }

    if (typeof value === "object" && value.constructor === Object) {
      const result: Record<string, unknown> = {};
      const obj = value as Record<string, unknown>;

      for (const [key, val] of Object.entries(obj)) {
        if (
          isSensitiveKey(key) ||
          /orgId$/i.test(key) ||
          /instanceName$/i.test(key) ||
          /deploymentName$/i.test(key) ||
          /apiVersion$/i.test(key)
        ) {
          continue;
        }
        result[key] = this.removeKeysRecursive(val);
      }

      return result;
    }

    return value;
  }

  async openLogFile(): Promise<void> {
    const app = this.app;
    if (!app?.vault?.adapter) return;
    const path = this.getLogPath();

    const bufferSnapshot = [...this.buffer];

    try {
      const sanitizedSettings = this.sanitizeSettingsForLog();
      const settingsJson = JSON.stringify(sanitizedSettings, null, 2);
      const settingsLines = ["", "## Settings", "```json", ...settingsJson.split("\n"), "```"];

      bufferSnapshot.push(...settingsLines);
    } catch {
      // If settings export fails, continue without settings block
    }

    try {
      const content = bufferSnapshot.join("\n") + (bufferSnapshot.length ? "\n" : "");
      const folder = path.includes("/") ? path.split("/").slice(0, -1).join("/") : "";
      if (folder) {
        await ensureFolderExists(app.vault, folder);
      }

      const fileExists = await app.vault.adapter.exists(path);
      if (fileExists) {
        await app.vault.adapter.write(path, content);
      } else {
        await app.vault.create(path, content);
      }
    } catch {
      // Swallow write errors; logging should never crash the app
    }

    const abstract = app.vault.getAbstractFileByPath(path);
    const file = abstract instanceof TFile ? abstract : null;
    try {
      if (file) {
        const leaf = app.workspace.getLeaf(true);
        await leaf.openFile(file);
      }
    } catch {
      // ignore
    }
  }
}

export const logFileManager = LogFileManager.getInstance();
