import { prependCopilotInstructions, stripCopilotInstructions } from "./instructions";
import { createRequire } from "node:module";
import { type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createInterface, type Interface } from "node:readline";
import {
  DEFAULT_GEMINI_MODELS,
  contextWindowForModel,
  parseAgyModelsOutput,
  type AgyModelEntry,
} from "./gemini-backend";
const MAX_DIFF_EXPAND_BYTES = 4 * 1024 * 1024;
import { mergeDiffIntoContent, synthesizeEditDiff, type AcpDiffBlock } from "./diff-synthesize";
import { antigravitySettingsPaths } from "./platform";
import { grokCliNeedsShell, spawnCli } from "./platform";
export const DEFAULT_AGY_EFFORT = "medium";
function toolKind(name: string): string {
  switch (name) {
    case "write_to_file":
    case "replace_file_content":
    case "multi_replace_file_content":
    case "sed_file":
      return "edit";
    case "run_command":
      return "execute";
    case "grep_search":
    case "search_web":
    case "find_by_name":
      return "search";
    case "view_file":
    case "list_dir":
    case "read_resource":
    case "read_url_content":
    case "read_browser_page":
      return "read";
    default:
      return "other";
  }
}
export function normalizeToolInput(name: string, params: any): Record<string, any> {
  const p = { ...(params || {}) };
  if (p.CommandLine) {
    p.command = p.CommandLine;
    p.cmd = p.CommandLine;
  }
  if (p.TargetFile) {
    p.file_path = p.TargetFile;
    p.path = p.TargetFile;
    p.target_file = p.TargetFile;
  }
  if (p.AbsolutePath) {
    p.file_path = p.AbsolutePath;
    p.path = p.AbsolutePath;
  }
  if (p.DirectoryPath) {
    p.directory = p.DirectoryPath;
    p.target_directory = p.DirectoryPath;
    p.path = p.DirectoryPath;
  }
  if (p.Query) {
    p.pattern = p.Query;
    p.query = p.Query;
  }
  if (p.Pattern) {
    p.pattern = p.Pattern;
    p.glob_pattern = p.Pattern;
  }
  if (p.SearchDirectory) {
    p.path = p.SearchDirectory;
    p.directory = p.SearchDirectory;
  }
  if (p.Url) {
    p.url = p.Url;
    p.uri = p.Url;
  }
  return p;
}
function toolTitle(name: string, params: any): string {
  const p = params || {};
  switch (name) {
    case "write_to_file": {
      const file =
        p.TargetFile || p.file_path || p.path
          ? path.basename(p.TargetFile || p.file_path || p.path)
          : "file";
      return `Create ${file}`;
    }
    case "replace_file_content":
    case "multi_replace_file_content": {
      const file =
        p.TargetFile || p.file_path || p.path
          ? path.basename(p.TargetFile || p.file_path || p.path)
          : "file";
      return `Edit ${file}`;
    }
    case "view_file": {
      const file =
        p.AbsolutePath || p.file_path || p.path
          ? path.basename(p.AbsolutePath || p.file_path || p.path)
          : "file";
      return `Read ${file}`;
    }
    case "list_dir": {
      const dir =
        p.DirectoryPath || p.directory || p.path
          ? path.basename(p.DirectoryPath || p.directory || p.path)
          : "directory";
      return `List ${dir}`;
    }
    case "grep_search": {
      const q = p.Query || p.pattern || p.query;
      return q ? `Search "${q}"` : "grep_search";
    }
    case "find_by_name": {
      const pattern = p.Pattern || p.pattern || p.Query || p.query;
      return pattern ? `Find "${pattern}"` : "find_by_name";
    }
    case "search_web": {
      const q = p.Query || p.pattern || p.query;
      return q ? `Web search "${q}"` : "search_web";
    }
    case "run_command": {
      const cmd = p.CommandLine || p.command || p.cmd;
      return cmd ? cmd.split(/\r?\n/)[0].slice(0, 80) : "run_command";
    }
    default:
      return name;
  }
}
export function normalizeBaselineKey(file: string, cwd: string): string {
  const resolved = path.isAbsolute(file)
    ? path.normalize(file)
    : path.normalize(path.resolve(cwd, file));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
export function sanitizeAgyToolErrorMessage(rawMessage: any): any {
  if (typeof rawMessage === "string") {
    if (/not a valid artifact path/i.test(rawMessage)) {
      return "Artifact Path Error: TargetFile is in workspace, but model included ArtifactMetadata (only valid for internal brain artifacts). Retrying without ArtifactMetadata...";
    }
    if (/missing property ['"]Pattern['"]/i.test(rawMessage)) {
      return "Invalid Tool Call: Missing required property 'Pattern' (must specify glob pattern like '*'). Retrying...";
    }
    return rawMessage;
  }
  if (rawMessage && typeof rawMessage === "object") {
    if (typeof rawMessage.message === "string") {
      return { ...rawMessage, message: sanitizeAgyToolErrorMessage(rawMessage.message) };
    }
    if (typeof rawMessage.error === "string") {
      return { ...rawMessage, error: sanitizeAgyToolErrorMessage(rawMessage.error) };
    }
  }
  return rawMessage;
}
export function findTranscriptPath(
  conversationId: string,
  geminiHome?: string
): string | undefined {
  const home = geminiHome || path.join(os.homedir(), ".gemini");
  const baseDirs = [
    path.join(home, "antigravity-cli", "brain", conversationId, ".system_generated", "logs"),
    path.join(home, "antigravity-ide", "brain", conversationId, ".system_generated", "logs"),
    path.join(home, "antigravity", "brain", conversationId, ".system_generated", "logs"),
    path.join(home, "brain", conversationId, ".system_generated", "logs"),
    path.join(
      os.homedir(),
      ".gemini",
      "antigravity-cli",
      "brain",
      conversationId,
      ".system_generated",
      "logs"
    ),
    path.join(
      os.homedir(),
      ".gemini",
      "antigravity-ide",
      "brain",
      conversationId,
      ".system_generated",
      "logs"
    ),
    path.join(
      os.homedir(),
      ".gemini",
      "antigravity",
      "brain",
      conversationId,
      ".system_generated",
      "logs"
    ),
    path.join(os.homedir(), ".gemini", "brain", conversationId, ".system_generated", "logs"),
  ];
  for (const dir of baseDirs) {
    const fullPath = path.join(dir, "transcript_full.jsonl");
    if (fs.existsSync(fullPath)) return fullPath;
  }
  for (const dir of baseDirs) {
    const compactPath = path.join(dir, "transcript.jsonl");
    if (fs.existsSync(compactPath)) return compactPath;
  }
  return undefined;
}
export function findRecentTranscriptToolCall(
  conversationId: string | undefined,
  geminiHome: string | undefined,
  toolName: string,
  filePath: string,
  cwd: string,
  stepIndex?: number
): any {
  if (!conversationId) return undefined;
  const transcriptPath = findTranscriptPath(conversationId, geminiHome);
  if (!transcriptPath) return undefined;
  try {
    const content = fs.readFileSync(transcriptPath, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    const targetKey = normalizeBaselineKey(filePath, cwd);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const step = JSON.parse(lines[i]);
        if (stepIndex != null) {
          if (step.step_index !== stepIndex && step.step_index !== stepIndex - 1) {
            continue;
          }
        }
        if (Array.isArray(step.tool_calls)) {
          for (const tc of step.tool_calls) {
            const name = tc.name ?? tc.tool_name ?? tc.toolName ?? tc.tool?.name;
            if (name === toolName) {
              const raw = unwrapTranscriptStrings(tc.args ?? tc.parameters ?? tc.params ?? {});
              const file = raw?.TargetFile || raw?.file_path || raw?.path;
              if (typeof file === "string" && normalizeBaselineKey(file, cwd) === targetKey) {
                return raw;
              }
            }
          }
        }
      } catch {}
    }
  } catch {}
  return undefined;
}
export function unwrapTranscriptStrings(params: any): any {
  if (!params || typeof params !== "object") return params;
  const out: any = Array.isArray(params) ? [] : {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      try {
        const decoded = JSON.parse(value);
        out[key] = typeof decoded === "string" ? decoded : value;
      } catch {
        if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
          out[key] = value.slice(1, -1);
        } else {
          out[key] = value;
        }
      }
    } else if (value && typeof value === "object") {
      out[key] = unwrapTranscriptStrings(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
export function synthesizeAgyToolDiff(
  name: string,
  rawParams: any,
  opts: {
    diskOldText?: string;
  } = {}
): AcpDiffBlock | undefined {
  const p = rawParams && typeof rawParams === "object" ? rawParams : {};
  switch (name) {
    case "write_to_file": {
      const file = p.TargetFile || p.file_path || p.path;
      if (typeof file !== "string" || !file) return undefined;
      const newText = typeof p.CodeContent === "string" ? p.CodeContent : "";
      return synthesizeEditDiff({ path: file, oldText: opts.diskOldText ?? "", newText });
    }
    case "replace_file_content": {
      const file = p.TargetFile || p.file_path || p.path;
      if (typeof file !== "string" || !file) return undefined;
      const oldText = typeof p.TargetContent === "string" ? p.TargetContent : "";
      const newText = typeof p.ReplacementContent === "string" ? p.ReplacementContent : "";
      const parsedStart =
        typeof p.StartLine === "number"
          ? p.StartLine
          : typeof p.StartLine === "string"
            ? parseInt(p.StartLine, 10)
            : NaN;
      const startLine = Number.isInteger(parsedStart) && parsedStart >= 1 ? parsedStart : undefined;
      const lineCountNeutral =
        (oldText ? oldText.split(/\r?\n/).length : 0) ===
        (newText ? newText.split(/\r?\n/).length : 0);
      return synthesizeEditDiff({
        path: file,
        oldText,
        newText,
        oldLine: startLine,
        ...(lineCountNeutral && startLine !== undefined ? { newLine: startLine } : {}),
      });
    }
    case "multi_replace_file_content": {
      const file = p.TargetFile || p.file_path || p.path;
      if (typeof file !== "string" || !file) return undefined;
      const chunks = Array.isArray(p.ReplacementChunks) ? p.ReplacementChunks : [];
      if (!chunks.length) return undefined;
      const details = chunks.map((chunk: any) => {
        const parsedLine =
          typeof chunk?.StartLine === "number"
            ? chunk.StartLine
            : typeof chunk?.StartLine === "string"
              ? parseInt(chunk.StartLine, 10)
              : NaN;
        return {
          old_string: typeof chunk?.TargetContent === "string" ? chunk.TargetContent : "",
          new_string: typeof chunk?.ReplacementContent === "string" ? chunk.ReplacementContent : "",
          ...(Number.isInteger(parsedLine) && parsedLine >= 1 ? { old_line: parsedLine } : {}),
        };
      });
      const first = chunks[0] ?? {};
      return synthesizeEditDiff({
        path: file,
        oldText: typeof first.TargetContent === "string" ? first.TargetContent : "",
        newText: typeof first.ReplacementContent === "string" ? first.ReplacementContent : "",
        details,
      });
    }
    default:
      return undefined;
  }
}
export function isImplementationPlanTool(name: string, params: any): boolean {
  if (!params || typeof params !== "object") return false;
  const target = String(
    params.TargetFile || params.AbsolutePath || params.file_path || params.path || ""
  );
  if (/(?:^|[\\/])implementation_plan\.md$/i.test(target)) return true;
  if (params.ArtifactMetadata?.RequestFeedback === true && /\.md$/i.test(target)) return true;
  return false;
}
export function extractPlanText(params: any, cwd?: string): string {
  if (!params || typeof params !== "object") return "";
  if (typeof params.CodeContent === "string" && params.CodeContent.trim()) {
    return params.CodeContent;
  }
  if (typeof params.content === "string" && params.content.trim()) {
    return params.content;
  }
  if (typeof params.ReplacementContent === "string" && params.ReplacementContent.trim()) {
    return params.ReplacementContent;
  }
  const target = params.TargetFile || params.AbsolutePath || params.file_path || params.path;
  if (typeof target === "string" && target) {
    try {
      const resolved = path.isAbsolute(target)
        ? target
        : cwd
          ? path.resolve(cwd, target)
          : path.resolve(target);
      if (fs.existsSync(resolved)) {
        return fs.readFileSync(resolved, "utf8");
      }
    } catch {}
  }
  return "";
}
export interface StoredSessionInfo {
  modelId?: string;
  effort?: string;
  modeId?: string;
  conversationId: string;
  cwd: string;
  title?: string;
  updatedAt: number;
}
export function cleanPromptTitle(text: string): string {
  if (!text) return "Antigravity Session";
  const m = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
  const raw = m ? m[1] : text;
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/<[^>]+>/g, "").trim())
    .filter(
      (l) =>
        l.length > 0 && !l.startsWith("Currently open") && !l.startsWith("The current local time")
    );
  const first = lines[0]?.trim();
  return first ? (first.length > 80 ? `${first.slice(0, 77)}…` : first) : "Antigravity Session";
}
export interface AgyAdapterOptions {
  modelDiscovery?: () => Promise<string>;
  agyPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  defaultModelId?: string;
  defaultEffort?: string;
  defaultModeId?: string;
  printTimeout?: string;
  geminiHome?: string;
  conversationStorePath?: string;
  inputStream?: NodeJS.ReadableStream;
  outputStream?: NodeJS.WritableStream;
  spawnFn?: (command: string, args: string[], options: any) => ChildProcessWithoutNullStreams;
  supportsInputFormat?: boolean;
  diskPollAttempts?: number;
  diskPollDelayMs?: number;
}
export const STAGED_IMAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STAGED_IMAGE_NAME = /^image-[0-9a-f-]{36}\.(png|jpe?g|webp|gif)$/i;
export function sweepStaleStagedImages(
  dirs: readonly string[],
  now = Date.now(),
  maxAgeMs = STAGED_IMAGE_MAX_AGE_MS
): string[] {
  const removed: string[] = [];
  for (const dir of dirs) {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!STAGED_IMAGE_NAME.test(name)) continue;
      const file = path.join(dir, name);
      try {
        const st = fs.statSync(file);
        if (!st.isFile() || now - st.mtimeMs < maxAgeMs) continue;
        fs.rmSync(file, { force: true });
        removed.push(file);
      } catch {}
    }
  }
  return removed;
}
export interface PromptUsage {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  totalTokens: number;
}
export class AgyAcpAdapterServer {
  private readonly agyPath: string;
  cwd: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly spawnFn: (
    command: string,
    args: string[],
    options: any
  ) => ChildProcessWithoutNullStreams;
  private readonly input: NodeJS.ReadableStream;
  private readonly output: NodeJS.WritableStream;
  private readonly printTimeout: string;
  private readonly geminiHome: string;
  private readonly diskPollAttempts: number;
  private readonly diskPollDelayMs: number;
  private readonly pendingWriteOldText = new Map<string, string | undefined>();
  private readonly sessionFileBaseline = new Map<string, string | undefined>();
  private pendingEditRecheck: Array<{
    toolCallId: string;
    file: string;
    diskOldText: string | undefined;
  }> = [];
  private pendingDiffPromises: Promise<unknown>[] = [];
  private readonly stagedImages = new Set<string>();
  private rl?: Interface;
  private agyProc?: ChildProcessWithoutNullStreams;
  private agyRl?: Interface;
  private agyErrRl?: Interface;
  sessionId?: string;
  currentModelId: string;
  currentEffort: string;
  currentModeId: string;
  activeConversationId?: string;
  pendingExitPlanId?: number | string;
  private respawnBeforeNextPrompt = false;
  private readonly conversationStorePath: string;
  private pendingPrompt?: {
    id: number | string;
    resolve: (result: any) => void;
    reject: (error: any) => void;
    usage: PromptUsage;
  };
  constructor(options: AgyAdapterOptions = {}) {
    this.agyPath =
      options.agyPath || process.env.AGY_PATH || process.env.GEMINI_CLI_EXECUTABLE || "agy";
    this.cwd = options.cwd || process.env.AGY_CWD || process.cwd();
    this.env = options.env || { ...process.env };
    this.currentModelId = options.defaultModelId || "gemini-3.8-flash";
    this.currentEffort = options.defaultEffort || "";
    this.currentModeId = options.defaultModeId || process.env.AGY_DEFAULT_MODE || "agent";
    this.geminiHome =
      options.geminiHome || this.env.GEMINI_HOME || path.join(os.homedir(), ".gemini");
    this.conversationStorePath =
      options.conversationStorePath || path.join(this.geminiHome, "copilot-acp-conversations.json");
    this.printTimeout =
      options.printTimeout ||
      options.env?.AGY_PRINT_TIMEOUT ||
      process.env.AGY_PRINT_TIMEOUT ||
      "24h";
    this.input = options.inputStream || process.stdin;
    this.output = options.outputStream || process.stdout;
    this.spawnFn = options.spawnFn || ((cmd, args, opts) => spawnCli(cmd, args, opts));
    const discoverLiveModels = !options.spawnFn && process.env.VITEST !== "true";
    this.modelDiscovery =
      options.modelDiscovery ??
      (discoverLiveModels
        ? () =>
            new Promise<string>((resolve, reject) => {
              const proc = this.spawnFn(this.agyPath, ["models"], {
                cwd: this.cwd,
                env: this.env,
                stdio: ["pipe", "pipe", "pipe"],
                shell: grokCliNeedsShell(this.agyPath),
                windowsHide: true,
              });
              let output = "";
              const timer = setTimeout(() => {
                proc.kill();
                reject(new Error("Model discovery timed out"));
              }, 3000);
              timer.unref();
              proc.stdout.on("data", (chunk) => {
                output += chunk.toString();
                if (output.length > 1024 * 1024) {
                  proc.kill();
                  clearTimeout(timer);
                  reject(new Error("Model listing too large"));
                }
              });
              proc.on("error", (error) => {
                clearTimeout(timer);
                reject(error);
              });
              proc.on("close", (code) => {
                clearTimeout(timer);
                if (code === 0) resolve(output);
                else reject(new Error("Model discovery unavailable"));
              });
            })
        : undefined);
    this.diskPollAttempts = options.diskPollAttempts ?? 50;
    this.diskPollDelayMs = options.diskPollDelayMs ?? 200;
    this.supportsInputFormatStreamJson =
      options.supportsInputFormat ?? (options.spawnFn ? true : undefined);
  }
  private supportsInputFormatStreamJson?: boolean;
  private readonly effortRequirementOverrides = new Map<string, boolean>();
  private readonly lastStderrBuffer: string[] = [];
  private lastUsage: PromptUsage = {
    inputTokens: 0,
    outputTokens: 0,
    thoughtTokens: 0,
    totalTokens: 0,
  };
  private discoveredModels?: AgyModelEntry[];
  private modelDiscovery?: () => Promise<string>;
  private async refreshAvailableModels(): Promise<void> {
    if (!this.modelDiscovery) return;
    try {
      const result = parseAgyModelsOutput(await this.modelDiscovery());
      if (result.availableModels.length) {
        this.discoveredModels = result.availableModels;
        if (!this.discoveredModels.some((model) => model.modelId === this.currentModelId))
          this.currentModelId = this.discoveredModels[0].modelId;
      }
    } catch {}
  }
  private modelContextWindow(modelId: string): number | undefined {
    return (
      this.discoveredModels?.find((model) => model.modelId === modelId)?._meta.totalContextTokens ??
      contextWindowForModel(modelId)
    );
  }
  async probeSupportsInputFormat(): Promise<boolean> {
    if (this.supportsInputFormatStreamJson !== undefined) {
      return this.supportsInputFormatStreamJson;
    }
    try {
      const proc = spawnCli(this.agyPath, ["--help"], {
        windowsHide: true,
        shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(this.agyPath),
      });
      const supportsFlag = await new Promise<boolean>((resolve) => {
        let out = "";
        const timer = setTimeout(() => {
          proc.kill();
          resolve(true);
        }, 5000);
        proc.stdout?.on("data", (chunk) => {
          out += chunk;
        });
        proc.stderr?.on("data", (chunk) => {
          out += chunk;
        });
        proc.on("error", () => {
          clearTimeout(timer);
          resolve(true);
        });
        proc.on("close", () => {
          clearTimeout(timer);
          resolve(out.includes("--input-format"));
        });
      });
      this.supportsInputFormatStreamJson = supportsFlag;
    } catch {
      this.supportsInputFormatStreamJson = true;
    }
    return this.supportsInputFormatStreamJson;
  }
  getReasoningEfforts(modelId = this.currentModelId): string[] {
    if (/(?:^|-)(low|medium|high)$/.test(modelId)) return [];
    const override = this.effortRequirementOverrides.get(modelId);
    if (override === false) return [];
    const model =
      this.discoveredModels?.find((entry) => entry.modelId === modelId) ??
      DEFAULT_GEMINI_MODELS.find((entry) => entry.modelId === modelId);
    if (override !== true && model?._meta.supportsReasoningEffort !== true) return [];
    const levels =
      model?._meta && "reasoningEfforts" in model._meta ? model._meta.reasoningEfforts : undefined;
    return levels?.map((entry) => entry.value) ?? ["low", "medium", "high"];
  }
  effectiveModelRequiresEffort(modelId: string): boolean {
    return this.getReasoningEfforts(modelId).length > 0;
  }
  private resolveCurrentEffort(): string {
    const levels = this.getReasoningEfforts();
    return levels.includes(this.currentEffort)
      ? this.currentEffort
      : levels.includes(DEFAULT_AGY_EFFORT)
        ? DEFAULT_AGY_EFFORT
        : (levels[0] ?? "");
  }
  getAvailableModels(): AgyModelEntry[] {
    const list: AgyModelEntry[] = this.discoveredModels
      ? [...this.discoveredModels]
      : DEFAULT_GEMINI_MODELS.map((model) => ({
          ...model,
          _meta: { ...model._meta, contextQuality: "estimated" },
        }));
    if (this.currentModelId && !list.some((m) => m.modelId === this.currentModelId)) {
      list.unshift({
        modelId: this.currentModelId,
        name: `${this.currentModelId} (Custom)`,
        description: "Custom Antigravity model ID",
        _meta: {
          supportsReasoningEffort: this.effectiveModelRequiresEffort(this.currentModelId),
          reasoningEfforts: [{ value: "low" }, { value: "medium" }, { value: "high" }],
          totalContextTokens: contextWindowForModel(this.currentModelId),
        },
      });
    }
    return list;
  }
  start(): void {
    this.rl = createInterface({ input: this.input });
    this.rl.on("line", (line) => {
      void this.handleClientLine(line);
    });
    this.input.on("end", () => this.dispose());
  }
  dispose(): void {
    this.rl?.close();
    this.rl = undefined;
    this.killAgyProc();
    this.activeConversationId = undefined;
    this.pendingExitPlanId = undefined;
    this.pendingWriteOldText.clear();
    this.pendingEditRecheck = [];
    this.pendingDiffPromises = [];
  }
  private readConversationStore(): Record<string, StoredSessionInfo> {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.conversationStorePath, "utf8"));
      if (!parsed || typeof parsed !== "object") return {};
      const result: Record<string, StoredSessionInfo> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") {
          const enriched = this.enrichSessionFromTranscript(v);
          result[k] = {
            conversationId: v,
            cwd: enriched?.cwd || this.cwd || "",
            title: enriched?.title || "Antigravity Session",
            updatedAt: enriched?.updatedAt || Date.now(),
          };
        } else if (v && typeof v === "object") {
          const item = v as any;
          result[k] = {
            modelId: typeof item.modelId === "string" ? item.modelId : undefined,
            effort: typeof item.effort === "string" ? item.effort : undefined,
            modeId: typeof item.modeId === "string" ? item.modeId : undefined,
            conversationId: typeof item.conversationId === "string" ? item.conversationId : "",
            cwd: typeof item.cwd === "string" ? item.cwd : this.cwd || "",
            title: typeof item.title === "string" ? item.title : undefined,
            updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : Date.now(),
          };
        }
      }
      return result;
    } catch {
      return {};
    }
  }
  private writeConversationStore(store: Record<string, StoredSessionInfo>): void {
    try {
      fs.mkdirSync(path.dirname(this.conversationStorePath), { recursive: true });
      fs.writeFileSync(this.conversationStorePath, JSON.stringify(store, null, 2), "utf8");
    } catch {}
  }
  rememberConversation(
    sessionId: string,
    conversationId: string,
    meta?: {
      cwd?: string;
      title?: string;
      updatedAt?: number;
    }
  ): void {
    const store = this.readConversationStore();
    const existing = store[sessionId];
    store[sessionId] = {
      modelId: this.currentModelId,
      effort: this.currentEffort,
      modeId: this.currentModeId,
      conversationId: conversationId || existing?.conversationId || "",
      cwd: meta?.cwd || existing?.cwd || this.cwd || "",
      title: meta?.title || existing?.title,
      updatedAt: meta?.updatedAt || existing?.updatedAt || Date.now(),
    };
    this.writeConversationStore(store);
  }
  private forgetConversation(sessionId: string): void {
    const store = this.readConversationStore();
    if (!(sessionId in store)) return;
    delete store[sessionId];
    this.writeConversationStore(store);
  }
  lookupConversation(sessionId: string): string | undefined {
    const store = this.readConversationStore();
    const found = store[sessionId];
    if (found?.conversationId) return found.conversationId;
    if (
      this.readNativeAntigravitySessions(this.cwd).some((entry) => entry.sessionId === sessionId) ||
      findTranscriptPath(sessionId, this.geminiHome)
    ) {
      return sessionId;
    }
    return undefined;
  }
  private enrichSessionFromTranscript(conversationId: string):
    | {
        title?: string;
        cwd?: string;
        updatedAt?: number;
      }
    | undefined {
    const transcriptPath = findTranscriptPath(conversationId, this.geminiHome);
    if (!transcriptPath) return undefined;
    try {
      const stat = fs.statSync(transcriptPath);
      const lines = fs.readFileSync(transcriptPath, "utf8").split(/\r?\n/).filter(Boolean);
      let title: string | undefined;
      let cwd: string | undefined;
      for (const line of lines) {
        try {
          const s = JSON.parse(line);
          if (!title && s.type === "USER_INPUT" && typeof s.content === "string") {
            title = cleanPromptTitle(s.content);
          }
          if (!cwd && s.tool_calls && Array.isArray(s.tool_calls)) {
            for (const tc of s.tool_calls) {
              const c =
                tc.args?.Cwd || tc.args?.SearchPath || tc.args?.AbsolutePath || tc.args?.TargetFile;
              if (typeof c === "string") {
                const cleaned = c.replace(/^["']+|["']+$/g, "").replace(/\\\\/g, "\\");
                if (cleaned.includes(":") || cleaned.startsWith("/")) {
                  try {
                    cwd =
                      fs.existsSync(cleaned) && fs.statSync(cleaned).isDirectory()
                        ? cleaned
                        : path.dirname(cleaned);
                  } catch {
                    cwd = path.dirname(cleaned);
                  }
                  break;
                }
              }
            }
          }
          if (title && cwd) break;
        } catch {}
      }
      return { title, cwd, updatedAt: stat.mtimeMs };
    } catch {
      return undefined;
    }
  }
  private readNativeAntigravitySessions(targetCwd?: string): any[] {
    const candidates = [
      path.join(this.geminiHome, "antigravity-cli", "conversation_summaries.db"),
      path.join(this.geminiHome, "antigravity", "conversation_summaries.db"),
      path.join(os.homedir(), ".gemini", "antigravity-cli", "conversation_summaries.db"),
      path.join(os.homedir(), ".gemini", "antigravity", "conversation_summaries.db"),
    ];
    const dbPath = candidates.find((p) => fs.existsSync(p));
    if (!dbPath) return [];
    try {
      const { DatabaseSync } = createRequire(__filename)("node:sqlite");
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const query =
        "SELECT conversation_id, title, workspace_uris, last_modified_time FROM conversation_summaries ORDER BY last_modified_time DESC LIMIT 100";
      const rows = db.prepare(query).all() as Array<{
        conversation_id: string;
        title: string;
        workspace_uris: string;
        last_modified_time: string;
      }>;
      db.close();
      const normalizeKey = (p: string) => {
        const resolved = path.resolve(p);
        return process.platform === "win32" ? resolved.toLowerCase() : resolved;
      };
      const targetKey = targetCwd ? normalizeKey(targetCwd) : undefined;
      const results: any[] = [];
      for (const row of rows) {
        if (!row.conversation_id) continue;
        let uris: string[] = [];
        try {
          if (row.workspace_uris) uris = JSON.parse(row.workspace_uris);
        } catch {}
        let matchedCwd = "";
        if (Array.isArray(uris) && uris.length > 0) {
          for (const rawUri of uris) {
            let localPath = rawUri.replace(/^file:\/\//i, "");
            if (/^\/[a-zA-Z]:[/\\]/.test(localPath)) localPath = localPath.slice(1);
            try {
              localPath = decodeURIComponent(localPath);
            } catch {}
            const norm = normalizeKey(localPath);
            if (
              !targetKey ||
              norm === targetKey ||
              targetKey.startsWith(norm) ||
              norm.startsWith(targetKey)
            ) {
              matchedCwd = targetCwd || localPath;
              break;
            }
          }
        }
        if (targetKey && !matchedCwd) continue;
        const updatedAt = row.last_modified_time
          ? Date.parse(row.last_modified_time) || Date.now()
          : Date.now();
        results.push({
          sessionId: row.conversation_id,
          cwd: matchedCwd || targetCwd || this.cwd,
          title: row.title?.trim() || "Antigravity Session",
          updatedAt,
        });
      }
      return results;
    } catch {
      return [];
    }
  }
  listStoredSessions(targetCwd?: string): any[] {
    const store = this.readConversationStore();
    const result: any[] = [];
    const seenSessionIds = new Set<string>();
    const seenConversationIds = new Set<string>();
    const normalizeKey = (p: string) => {
      const resolved = path.resolve(p);
      return process.platform === "win32" ? resolved.toLowerCase() : resolved;
    };
    const targetKey = targetCwd ? normalizeKey(targetCwd) : undefined;
    for (const [sessionId, info] of Object.entries(store)) {
      if (!info) continue;
      if (!info.conversationId && (!info.title || info.title === "New session")) continue;
      const sessionCwd = info.cwd || this.cwd;
      if (targetKey && sessionCwd) {
        const norm = normalizeKey(sessionCwd);
        if (norm !== targetKey && !targetKey.startsWith(norm) && !norm.startsWith(targetKey)) {
          continue;
        }
      }
      seenSessionIds.add(sessionId);
      if (info.conversationId) seenConversationIds.add(info.conversationId);
      result.push({
        sessionId,
        cwd: targetCwd || sessionCwd,
        title: info.title || "Antigravity Session",
        updatedAt: info.updatedAt || Date.now(),
      });
    }
    try {
      const nativeSessions = this.readNativeAntigravitySessions(targetCwd);
      for (const entry of nativeSessions) {
        if (!seenSessionIds.has(entry.sessionId) && !seenConversationIds.has(entry.sessionId)) {
          seenSessionIds.add(entry.sessionId);
          result.push(entry);
        }
      }
    } catch {}
    result.sort((a, b) => {
      const aTime = typeof a.updatedAt === "number" ? a.updatedAt : Date.parse(a.updatedAt) || 0;
      const bTime = typeof b.updatedAt === "number" ? b.updatedAt : Date.parse(b.updatedAt) || 0;
      return bTime - aTime;
    });
    return result;
  }
  replayTranscript(conversationId: string): void {
    const transcriptPath = findTranscriptPath(conversationId, this.geminiHome);
    if (!transcriptPath) return;
    const touchedFiles = new Set<string>();
    try {
      const content = fs.readFileSync(transcriptPath, "utf8");
      const lines = content.split(/\r?\n/).filter(Boolean);
      const replayToolCallSeq = { n: 0 };
      for (const line of lines) {
        try {
          const step = JSON.parse(line);
          if (step.type === "USER_INPUT" && typeof step.content === "string") {
            const m = step.content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
            const userText = stripCopilotInstructions(m ? m[1].trim() : step.content.trim());
            if (userText) {
              this.sendNotification("session/update", {
                sessionId: this.sessionId,
                update: {
                  sessionUpdate: "user_message_chunk",
                  content: { type: "text", text: userText },
                },
              });
            }
          } else if (
            step.type === "PLANNER_RESPONSE" &&
            typeof step.content === "string" &&
            step.content.trim()
          ) {
            this.sendNotification("session/update", {
              sessionId: this.sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: step.content },
              },
            });
          }
          this.replayToolCalls(step, replayToolCallSeq, touchedFiles);
        } catch {}
      }
      for (const file of touchedFiles) {
        const currentDisk = this.readDiskTextForDiff(file);
        if (currentDisk !== undefined) {
          const key = normalizeBaselineKey(file, this.cwd);
          this.sessionFileBaseline.set(key, currentDisk);
        }
      }
    } catch {}
  }
  private replayToolCalls(
    step: any,
    seq: {
      n: number;
    },
    touchedFiles?: Set<string>
  ): void {
    const calls = Array.isArray(step?.tool_calls) ? step.tool_calls : [];
    for (const tc of calls) {
      if (!tc || typeof tc !== "object") continue;
      const name = tc.name ?? tc.tool_name ?? tc.toolName ?? tc.tool?.name;
      if (typeof name !== "string" || !name) continue;
      const rawParams = unwrapTranscriptStrings(tc.args ?? tc.parameters ?? tc.params ?? {});
      const params = normalizeToolInput(name, rawParams);
      if (
        touchedFiles &&
        (name === "write_to_file" ||
          name === "replace_file_content" ||
          name === "multi_replace_file_content")
      ) {
        const f = rawParams?.TargetFile || rawParams?.file_path || rawParams?.path;
        if (typeof f === "string" && f) touchedFiles.add(f);
      }
      const toolCallId = `replay-${seq.n++}`;
      const content = mergeDiffIntoContent(undefined, synthesizeAgyToolDiff(name, rawParams));
      this.sendNotification("session/update", {
        sessionId: this.sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId,
          title: toolTitle(name, params),
          kind: toolKind(name),
          status: "completed",
          rawInput: params,
          ...(content.length ? { content } : {}),
        },
      });
    }
  }
  private requestRespawn(): void {
    if (this.pendingPrompt) {
      this.respawnBeforeNextPrompt = true;
      return;
    }
    this.killAgyProc();
  }
  private cancelActiveTurn(): void {
    const pending = this.pendingPrompt;
    this.pendingPrompt = undefined;
    this.killAgyProc();
    if (pending) {
      pending.resolve({ stopReason: "cancelled", usage: pending.usage });
    }
  }
  private killAgyProc(): void {
    this.pendingExitPlanId = undefined;
    if (this.pendingPrompt) {
      const pending = this.pendingPrompt;
      this.pendingPrompt = undefined;
      pending.reject(new Error("Session terminated or reset"));
    }
    if (this.agyRl) {
      this.agyRl.close();
      this.agyRl = undefined;
    }
    if (this.agyErrRl) {
      this.agyErrRl.close();
      this.agyErrRl = undefined;
    }
    if (this.agyProc) {
      try {
        this.agyProc.stdin.end();
      } catch {}
      try {
        this.agyProc.kill();
      } catch {}
      this.agyProc = undefined;
    }
  }
  writeJsonRpc(message: any): void {
    const text = JSON.stringify(message) + "\n";
    this.output.write(text);
  }
  private sendResponse(id: number | string | undefined, result: any): void {
    if (id == null) return;
    this.writeJsonRpc({ jsonrpc: "2.0", id, result });
  }
  private sendError(id: number | string | undefined, code: number, message: string): void {
    if (id == null) return;
    this.writeJsonRpc({ jsonrpc: "2.0", id, error: { code, message } });
  }
  private sendNotification(method: string, params: any): void {
    this.writeJsonRpc({ jsonrpc: "2.0", method, params });
  }
  getConfigOptions() {
    const modelOptions = this.getAvailableModels().map((m) => ({
      value: m.modelId,
      name: m.name,
      description: m.description,
    }));
    if (this.currentModelId && !modelOptions.some((m) => m.value === this.currentModelId)) {
      modelOptions.unshift({
        value: this.currentModelId,
        name: `${this.currentModelId} (Custom)`,
        description: "Custom Antigravity model ID",
      });
    }
    return [
      {
        id: "model",
        type: "select",
        category: "model",
        name: "Model",
        currentValue: this.currentModelId,
        options: modelOptions,
      },
      ...(this.effectiveModelRequiresEffort(this.currentModelId)
        ? [
            {
              id: "reasoning_effort",
              type: "select",
              category: "thought_level",
              name: "Reasoning effort",
              currentValue: this.resolveCurrentEffort(),
              options: this.getReasoningEfforts().map((value) => ({
                value,
                name: value.charAt(0).toUpperCase() + value.slice(1),
              })),
            },
          ]
        : []),
      {
        id: "mode",
        type: "select",
        category: "mode",
        name: "Mode",
        currentValue: this.currentModeId,
        options: [
          { value: "agent", name: "Automatic tools" },
          { value: "plan", name: "Plan" },
        ],
      },
    ];
  }
  stagePromptImage(data: string, mimeType = "image/png", knownPath?: string): string {
    if (knownPath && typeof knownPath === "string") {
      try {
        if (fs.existsSync(knownPath) && fs.statSync(knownPath).isFile()) {
          return knownPath;
        }
      } catch {}
    }
    const ext =
      mimeType.includes("jpeg") || mimeType.includes("jpg")
        ? ".jpg"
        : mimeType.includes("webp")
          ? ".webp"
          : mimeType.includes("gif")
            ? ".gif"
            : ".png";
    const [stagingDir, fallbackDir] = this.stagingDirs();
    try {
      fs.mkdirSync(stagingDir, { recursive: true });
      const filePath = path.join(stagingDir, `image-${randomUUID()}${ext}`);
      fs.writeFileSync(filePath, Buffer.from(data, "base64"));
      this.stagedImages.add(filePath);
      return filePath;
    } catch {
      fs.mkdirSync(fallbackDir, { recursive: true });
      const filePath = path.join(fallbackDir, `image-${randomUUID()}${ext}`);
      fs.writeFileSync(filePath, Buffer.from(data, "base64"));
      this.stagedImages.add(filePath);
      return filePath;
    }
  }
  stagingDirs(): [string, string] {
    return [path.join(this.geminiHome, "staging"), path.join(os.tmpdir(), "gemini-staging")];
  }
  discardStagedImages(): void {
    for (const file of this.stagedImages) {
      try {
        fs.rmSync(file, { force: true });
      } catch {}
    }
    this.stagedImages.clear();
  }
  sweepStagedImages(now = Date.now()): string[] {
    return sweepStaleStagedImages(this.stagingDirs(), now);
  }
  processPromptBlocks(promptBlocks: any[], fallbackText?: string): string {
    let promptText = "";
    const imageInstructions: string[] = [];
    let imageCounter = 0;
    for (const block of promptBlocks) {
      if (typeof block === "string") {
        promptText += (promptText ? "\n" : "") + block;
      } else if (block && typeof block.text === "string") {
        promptText += (promptText ? "\n" : "") + block.text;
      } else if (block && block.type === "image") {
        imageCounter++;
        const data = typeof block.data === "string" ? block.data : "";
        const mimeType = typeof block.mimeType === "string" ? block.mimeType : "image/png";
        const knownPath = typeof block.path === "string" ? block.path : undefined;
        if (data || knownPath) {
          const imagePath = this.stagePromptImage(data, mimeType, knownPath);
          imageInstructions.push(
            `[Attached Image #${imageCounter}: Local file located at "${imagePath}". Please use the view_file tool on this path to inspect the image content.]`
          );
        }
      }
    }
    if (!promptText && typeof fallbackText === "string") {
      promptText = fallbackText;
    }
    promptText = promptText
      .replace(/\s*—\s*local staged copy;\s*thumbnail only;\s*do not access this path/gi, "")
      .replace(/\s*—\s*attached inline;\s*act on the path if needed,\s*but do not Read it/gi, "")
      .replace(
        /\s*\(attached inline\s*—\s*already visible to you;\s*do not read it from disk\)/gi,
        ""
      );
    if (imageInstructions.length > 0) {
      promptText = (promptText ? promptText + "\n\n" : "") + imageInstructions.join("\n");
    }
    return prependCopilotInstructions(promptText);
  }
  async handleClientLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req: any;
    try {
      req = JSON.parse(trimmed);
    } catch {
      return;
    }
    const { id, method, params } = req;
    if (id != null && this.pendingExitPlanId != null && id === this.pendingExitPlanId) {
      this.pendingExitPlanId = undefined;
      const outcome = req.result?.outcome;
      if (outcome === "approved") {
        this.currentModeId = "agent";
        this.sendNotification("session/update", {
          sessionId: this.sessionId,
          update: {
            sessionUpdate: "current_mode_update",
            currentModeId: "agent",
          },
        });
        if (this.agyProc) {
          this.requestRespawn();
        }
      }
      return;
    }
    if (!method) return;
    switch (method) {
      case "initialize": {
        this.sendResponse(id, {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
          },
        });
        break;
      }
      case "session/new": {
        await this.refreshAvailableModels();
        this.pendingExitPlanId = undefined;
        if (typeof params?.cwd === "string" && params.cwd) {
          this.cwd = params.cwd;
        }
        if (this.agyProc) {
          this.killAgyProc();
        }
        this.activeConversationId = undefined;
        this.sessionId = randomUUID();
        this.sendResponse(id, {
          sessionId: this.sessionId,
          models: {
            currentModelId: this.currentModelId,
            availableModels: this.getAvailableModels(),
          },
          configOptions: this.getConfigOptions(),
        });
        break;
      }
      case "session/load": {
        await this.refreshAvailableModels();
        this.pendingExitPlanId = undefined;
        if (typeof params?.cwd === "string" && params.cwd) {
          this.cwd = params.cwd;
        }
        if (this.agyProc) {
          this.killAgyProc();
        }
        const loadedSessionId =
          typeof params?.sessionId === "string" ? params.sessionId : randomUUID();
        this.sessionId = loadedSessionId;
        const saved = this.readConversationStore()[loadedSessionId];
        if (
          saved?.modelId &&
          this.getAvailableModels().some((model) => model.modelId === saved.modelId)
        ) {
          this.currentModelId = saved.modelId;
          this.currentEffort = saved.effort || "";
          this.currentEffort = this.resolveCurrentEffort();
          this.currentModeId = saved.modeId === "plan" ? "plan" : "agent";
        }
        this.activeConversationId = this.lookupConversation(loadedSessionId);
        if (!this.activeConversationId) {
          this.sessionId = undefined;
          this.sendError(
            id,
            -32001,
            "Antigravity conversation was not found. Saved history remains readable; start a new chat explicitly."
          );
          break;
        }
        if (this.activeConversationId) {
          this.replayTranscript(this.activeConversationId);
        }
        this.sendResponse(id, {
          sessionId: this.sessionId,
          models: {
            currentModelId: this.currentModelId,
            availableModels: this.getAvailableModels(),
          },
          configOptions: this.getConfigOptions(),
        });
        break;
      }
      case "session/set_config_option": {
        const configId = params?.configId;
        const value = params?.value;
        if (configId === "model" && typeof value === "string") {
          const prevModel = this.currentModelId;
          this.currentModelId = value;
          this.currentEffort = this.resolveCurrentEffort();
          if (prevModel !== value && this.agyProc) {
            this.requestRespawn();
          }
        } else if (
          (configId === "reasoning_effort" || configId === "effort") &&
          typeof value === "string"
        ) {
          const prevEffort = this.currentEffort;
          this.currentEffort = value === "default" ? "" : value;
          if (prevEffort !== this.currentEffort && this.agyProc) {
            this.requestRespawn();
          }
        } else if (configId === "mode" && typeof value === "string") {
          const prevMode = this.currentModeId;
          this.currentModeId =
            value === "yolo" || value === "agent-full-access" || value === "bypassPermissions"
              ? "yolo"
              : value === "plan"
                ? "plan"
                : "agent";
          if (prevMode !== this.currentModeId && this.agyProc) {
            this.requestRespawn();
          }
        }
        this.sendResponse(id, {
          configOptions: this.getConfigOptions(),
        });
        break;
      }
      case "session/set_mode": {
        const rawModeId = typeof params?.modeId === "string" ? params.modeId : "agent";
        const modeId =
          rawModeId === "yolo" ||
          rawModeId === "agent-full-access" ||
          rawModeId === "bypassPermissions"
            ? "yolo"
            : rawModeId === "plan"
              ? "plan"
              : "agent";
        const prevMode = this.currentModeId;
        this.currentModeId = modeId;
        if (prevMode !== modeId && this.agyProc) {
          this.requestRespawn();
        }
        this.sendResponse(id, {
          modes: {
            currentModeId: this.currentModeId,
          },
        });
        break;
      }
      case "session/prompt": {
        const promptBlocks = Array.isArray(params?.prompt) ? params.prompt : [];
        const promptText = this.processPromptBlocks(promptBlocks, params?.text);
        if (this.sessionId) {
          const cleanTitle = cleanPromptTitle(promptText);
          const store = this.readConversationStore();
          const existing = store[this.sessionId];
          if (existing) {
            if (!existing.title || existing.title === "Antigravity Session") {
              existing.title = cleanTitle;
            }
            existing.modelId = this.currentModelId;
            existing.effort = this.currentEffort;
            existing.modeId = this.currentModeId;
            existing.updatedAt = Date.now();
            if (this.cwd) existing.cwd = this.cwd;
            this.writeConversationStore(store);
          } else {
            store[this.sessionId] = {
              modelId: this.currentModelId,
              effort: this.currentEffort,
              modeId: this.currentModeId,
              conversationId: this.activeConversationId || "",
              cwd: this.cwd || "",
              title: cleanTitle,
              updatedAt: Date.now(),
            };
            this.writeConversationStore(store);
          }
        }
        if (promptText.trim() === "/compact") {
          this.sendNotification("session/update", {
            sessionId: this.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: {
                type: "text",
                text: "Antigravity automatically manages and compacts context in the background. No manual compaction is needed.",
              },
            },
          });
          this.sendResponse(id, {
            stopReason: "end_turn",
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
            },
          });
          break;
        }
        if (this.pendingPrompt) {
          this.sendError(id, -32603, "A turn is already running in this session");
          break;
        }
        try {
          await this.executePrompt(id, promptText);
        } catch {}
        break;
      }
      case "session/cancel": {
        this.pendingExitPlanId = undefined;
        this.cancelActiveTurn();
        this.sendResponse(id, {});
        break;
      }
      case "session/delete": {
        const target = typeof params?.sessionId === "string" ? params.sessionId : this.sessionId;
        if (target) this.forgetConversation(target);
        if (!target || target === this.sessionId) {
          this.cancelActiveTurn();
          this.activeConversationId = undefined;
          this.discardStagedImages();
        }
        this.sendResponse(id, {});
        break;
      }
      case "session/list": {
        const targetCwd = typeof params?.cwd === "string" && params.cwd ? params.cwd : this.cwd;
        const sessions = this.listStoredSessions(targetCwd);
        this.sendResponse(id, { sessions });
        break;
      }
      case "_x.ai/interject":
      case "x.ai/interject": {
        const text = typeof params?.text === "string" ? params.text : "";
        if (text && this.agyProc && !this.agyProc.killed) {
          try {
            const payload =
              JSON.stringify({
                event: "user",
                message: {
                  role: "user",
                  content: text,
                },
              }) + "\n";
            this.agyProc.stdin.write(payload);
          } catch {}
        }
        this.sendResponse(id, {});
        break;
      }
      case "_x.ai/mcp/list":
      case "x.ai/mcp/list": {
        const servers: any[] = [];
        const candidateFiles = [
          path.join(this.geminiHome, "antigravity-cli", "settings.json"),
          path.join(this.geminiHome, "settings.json"),
          ...antigravitySettingsPaths(this.geminiHome, this.env),
        ];
        for (const file of candidateFiles) {
          try {
            if (fs.existsSync(file)) {
              const raw = fs.readFileSync(file, "utf8");
              const parsed = JSON.parse(raw);
              const mcpServers = parsed?.mcpServers || parsed?.mcp_servers;
              if (mcpServers && typeof mcpServers === "object") {
                for (const [name, cfg] of Object.entries(mcpServers)) {
                  const s = cfg as any;
                  servers.push({
                    name,
                    displayName: s?.displayName || name,
                    enabled: s?.enabled !== false,
                    command: s?.command,
                    args: s?.args,
                    url: s?.url,
                    type: s?.type || (s?.url ? "sse" : "stdio"),
                    scope: "user",
                    scopeName: "Antigravity CLI",
                    configFile: path.basename(file),
                  });
                }
                break;
              }
            }
          } catch {}
        }
        this.sendResponse(id, { servers });
        break;
      }
      case "_x.ai/session/info":
      case "x.ai/session/info": {
        const windowSize = this.modelContextWindow(this.currentModelId);
        if (windowSize === undefined) {
          this.sendError(id, -32601, "Context limit unknown for this model");
          break;
        }
        const used = this.lastUsage.totalTokens || 0;
        this.sendResponse(id, {
          _meta: {
            contextWindowAuthoritative:
              this.discoveredModels?.find((model) => model.modelId === this.currentModelId)?._meta
                .contextQuality === "verified",
          },
          context: {
            used,
            total: windowSize,
            systemPromptTokens: 0,
            toolDefinitionsTokens: 0,
            messageTokens: used,
            freeTokens: Math.max(0, windowSize - used),
          },
        });
        break;
      }
      default: {
        if (id != null) {
          this.sendError(id, -32601, `Method not found: ${method}`);
        }
        break;
      }
    }
  }
  private readDiskTextForDiff(rawPath: string): string | undefined {
    try {
      const abs = path.isAbsolute(rawPath)
        ? path.normalize(rawPath)
        : path.normalize(path.resolve(this.cwd, rawPath));
      const stat = fs.statSync(abs);
      if (!stat.isFile() || stat.size > MAX_DIFF_EXPAND_BYTES) return undefined;
      return fs.readFileSync(abs, "utf8");
    } catch {
      return undefined;
    }
  }
  private async waitForDiskChangeText(
    file: string,
    before: string | undefined
  ): Promise<string | undefined> {
    for (let i = 0; i < this.diskPollAttempts; i++) {
      const text = this.readDiskTextForDiff(file);
      if (text !== before) return text;
      await new Promise((resolve) => setTimeout(resolve, this.diskPollDelayMs));
    }
    return this.readDiskTextForDiff(file);
  }
  private async synthesizeAgyDiffContent(
    toolCallId: string,
    name: string,
    rawParams: any,
    phase: "active" | "done" | "error",
    stepIndex?: number
  ): Promise<unknown[] | undefined> {
    if (
      name !== "write_to_file" &&
      name !== "replace_file_content" &&
      name !== "multi_replace_file_content"
    ) {
      return undefined;
    }
    const file = rawParams?.TargetFile || rawParams?.file_path || rawParams?.path;
    if (typeof file !== "string" || !file) return undefined;
    const baselineKey = normalizeBaselineKey(file, this.cwd);
    if (phase === "active") {
      const before = this.sessionFileBaseline.has(baselineKey)
        ? this.sessionFileBaseline.get(baselineKey)
        : this.readDiskTextForDiff(file);
      this.pendingWriteOldText.set(toolCallId, before);
      return undefined;
    }
    const diskOldText = this.pendingWriteOldText.get(toolCallId);
    this.pendingWriteOldText.delete(toolCallId);
    if (phase === "error") return undefined;
    let diffFromTranscript: AcpDiffBlock | undefined;
    const transcriptArgs = findRecentTranscriptToolCall(
      this.activeConversationId,
      this.geminiHome,
      name,
      file,
      this.cwd,
      stepIndex
    );
    if (transcriptArgs) {
      diffFromTranscript = synthesizeAgyToolDiff(name, transcriptArgs, { diskOldText });
    }
    const diskNewText = await this.waitForDiskChangeText(file, diskOldText);
    this.sessionFileBaseline.set(baselineKey, diskNewText);
    if (diffFromTranscript) {
      return mergeDiffIntoContent(undefined, diffFromTranscript);
    }
    if (diskOldText === undefined && diskNewText === undefined) return undefined;
    if (diskOldText === diskNewText) {
      this.pendingEditRecheck.push({ toolCallId, file, diskOldText });
    }
    return mergeDiffIntoContent(
      undefined,
      synthesizeEditDiff({ path: file, oldText: diskOldText ?? "", newText: diskNewText ?? "" })
    );
  }
  private flushPendingEditRechecks(): void {
    const pending = this.pendingEditRecheck;
    this.pendingEditRecheck = [];
    for (const { toolCallId, file, diskOldText } of pending) {
      const diskNewText = this.readDiskTextForDiff(file);
      if (diskNewText === undefined || diskNewText === diskOldText) continue;
      const baselineKey = normalizeBaselineKey(file, this.cwd);
      this.sessionFileBaseline.set(baselineKey, diskNewText);
      const diff = synthesizeEditDiff({
        path: file,
        oldText: diskOldText ?? "",
        newText: diskNewText,
      });
      if (!diff) continue;
      this.sendNotification("session/update", {
        sessionId: this.sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: "completed",
          content: [diff],
        },
      });
    }
  }
  private ensureAgyProc(overridePromptArgs?: string[]): ChildProcessWithoutNullStreams {
    if (this.respawnBeforeNextPrompt || (overridePromptArgs && overridePromptArgs.length > 0)) {
      this.respawnBeforeNextPrompt = false;
      this.killAgyProc();
    }
    if (
      this.agyProc &&
      !this.agyProc.killed &&
      this.agyProc.stdin.writable &&
      !overridePromptArgs
    ) {
      return this.agyProc;
    }
    const args: string[] = [];
    if (overridePromptArgs && overridePromptArgs.length > 0) {
      args.push(...overridePromptArgs);
      args.push("--output-format", "stream-json");
    } else {
      args.push("--input-format", "stream-json", "--output-format", "stream-json");
    }
    args.push("--print-timeout", this.printTimeout);
    if (this.cwd) {
      args.push("--add-dir", this.cwd);
    }
    const stagingDir = path.join(this.geminiHome, "staging");
    if (fs.existsSync(stagingDir)) {
      args.push("--add-dir", stagingDir);
    }
    if (this.currentModelId) {
      args.push("--model", this.currentModelId);
    }
    if (this.effectiveModelRequiresEffort(this.currentModelId)) {
      this.currentEffort = this.resolveCurrentEffort();
      args.push("--effort", this.currentEffort);
    }
    if (this.currentModeId === "plan") {
      args.push("--mode", "plan");
    }
    args.push("--dangerously-skip-permissions");
    if (this.activeConversationId) {
      args.push("--conversation", this.activeConversationId);
    }
    const proc = this.spawnFn(this.agyPath, args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(this.agyPath),
    });
    this.agyProc = proc;
    this.agyRl = createInterface({ input: proc.stdout });
    this.agyRl.on("line", (line) => this.handleAgyLine(line));
    if (proc.stderr) {
      this.agyErrRl = createInterface({ input: proc.stderr });
      this.agyErrRl.on("line", (line) => {
        if (line.trim()) {
          this.lastStderrBuffer.push(line);
          if (this.lastStderrBuffer.length > 50) this.lastStderrBuffer.shift();
          process.stderr.write(`[agy] ${line}\n`);
        }
      });
    }
    proc.on("exit", (code) => {
      if (this.pendingPrompt) {
        const pending = this.pendingPrompt;
        this.pendingPrompt = undefined;
        if (code !== 0) {
          pending.reject(new Error(`Antigravity CLI exited with code ${code}`));
        } else {
          pending.resolve({
            stopReason: "end_turn",
            usage: pending.usage,
          });
        }
      }
      this.agyProc = undefined;
    });
    proc.on("error", (err) => {
      if (this.pendingPrompt) {
        const pending = this.pendingPrompt;
        this.pendingPrompt = undefined;
        pending.reject(err instanceof Error ? err : new Error(String(err)));
      }
      this.agyProc = undefined;
    });
    return proc;
  }
  handleAgyLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let ev: any;
    try {
      ev = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (ev.event === "init") {
      if (typeof ev.conversation_id === "string" && ev.conversation_id) {
        this.activeConversationId = ev.conversation_id;
        if (this.sessionId) {
          this.rememberConversation(this.sessionId, ev.conversation_id, {
            cwd: this.cwd,
            updatedAt: Date.now(),
          });
        }
      }
      return;
    }
    if (ev.event === "step_update") {
      const step = ev.step_update;
      if (!step) return;
      if (
        step.step_type === "agent_response" &&
        typeof step.text_delta === "string" &&
        step.text_delta
      ) {
        this.sendNotification("session/update", {
          sessionId: this.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: step.text_delta,
            },
          },
        });
      }
      if (step.step_type === "tool") {
        const toolCallId = `tool-${step.step_index}`;
        const name = step.tool_name || step.tool_info?.name || "tool";
        const rawParams = step.tool_info?.parameters || {};
        const params = normalizeToolInput(name, rawParams);
        const kind = toolKind(name);
        const title = toolTitle(name, params);
        if (step.state === "ACTIVE") {
          void this.synthesizeAgyDiffContent(
            toolCallId,
            name,
            rawParams,
            "active",
            step.step_index
          ).then((content) => {
            this.sendNotification("session/update", {
              sessionId: this.sessionId,
              update: {
                sessionUpdate: "tool_call",
                toolCallId,
                title,
                kind,
                status: "in_progress",
                rawInput: params,
                ...(content && content.length ? { content } : {}),
              },
            });
          });
        } else {
          const isError = step.state === "ERROR";
          const rawOutput =
            step.tool_info?.output ??
            step.tool_info?.error?.message ??
            (isError ? "Tool execution failed" : "completed");
          const output = isError ? sanitizeAgyToolErrorMessage(rawOutput) : rawOutput;
          const diffPromise = this.synthesizeAgyDiffContent(
            toolCallId,
            name,
            rawParams,
            isError ? "error" : "done",
            step.step_index
          ).then((content) => {
            this.sendNotification("session/update", {
              sessionId: this.sessionId,
              update: {
                sessionUpdate: "tool_call_update",
                toolCallId,
                title,
                kind,
                status: isError ? "failed" : "completed",
                rawInput: params,
                rawOutput: typeof output === "string" ? { output } : output,
                ...(content && content.length ? { content } : {}),
              },
            });
            if (!isError && isImplementationPlanTool(name, rawParams)) {
              const planText = extractPlanText(rawParams, this.cwd);
              if (planText) {
                this.sendNotification("session/update", {
                  sessionId: this.sessionId,
                  update: {
                    sessionUpdate: "plan",
                    plan: planText,
                  },
                });
              }
              if (
                this.currentModeId === "plan" ||
                rawParams?.ArtifactMetadata?.RequestFeedback === true
              ) {
                const planReqId = randomUUID();
                this.pendingExitPlanId = planReqId;
                this.writeJsonRpc({
                  jsonrpc: "2.0",
                  id: planReqId,
                  method: "x.ai/exit_plan_mode",
                  params: {
                    sessionId: this.sessionId,
                    planContent: planText,
                  },
                });
              }
            }
          });
          this.pendingDiffPromises.push(diffPromise);
        }
      }
      if (step.usage && this.pendingPrompt) {
        const u = step.usage;
        this.pendingPrompt.usage.inputTokens =
          u.input_tokens ?? this.pendingPrompt.usage.inputTokens;
        this.pendingPrompt.usage.outputTokens =
          u.output_tokens ?? this.pendingPrompt.usage.outputTokens;
        this.pendingPrompt.usage.thoughtTokens =
          u.thinking_tokens ?? this.pendingPrompt.usage.thoughtTokens;
        this.pendingPrompt.usage.totalTokens =
          u.total_tokens ?? this.pendingPrompt.usage.totalTokens;
        this.lastUsage = { ...this.pendingPrompt.usage };
        const usedTokens = u.total_tokens ?? (u.input_tokens ?? 0) + (u.output_tokens ?? 0);
        if (typeof usedTokens === "number" && usedTokens > 0) {
          const windowSize = this.modelContextWindow(this.currentModelId);
          if (windowSize !== undefined && Number.isFinite(windowSize) && windowSize > 0) {
            this.sendNotification("session/update", {
              sessionId: this.sessionId,
              update: { sessionUpdate: "usage_update", used: usedTokens, size: windowSize },
            });
          }
        }
      }
      return;
    }
    if (ev.event === "result") {
      const res = ev.result;
      if (this.pendingPrompt) {
        const pending = this.pendingPrompt;
        this.pendingPrompt = undefined;
        void (async () => {
          const diffPromises = this.pendingDiffPromises;
          this.pendingDiffPromises = [];
          await Promise.allSettled(diffPromises);
          this.flushPendingEditRechecks();
          if (res?.usage) {
            pending.usage.inputTokens = res.usage.input_tokens ?? pending.usage.inputTokens;
            pending.usage.outputTokens = res.usage.output_tokens ?? pending.usage.outputTokens;
            pending.usage.thoughtTokens = res.usage.thinking_tokens ?? pending.usage.thoughtTokens;
            pending.usage.totalTokens = res.usage.total_tokens ?? pending.usage.totalTokens;
            this.lastUsage = { ...pending.usage };
            const usedTokens =
              res.usage.total_tokens ??
              (res.usage.input_tokens ?? 0) + (res.usage.output_tokens ?? 0);
            if (typeof usedTokens === "number" && usedTokens > 0) {
              const windowSize = this.modelContextWindow(this.currentModelId);
              if (windowSize !== undefined && Number.isFinite(windowSize) && windowSize > 0) {
                this.sendNotification("session/update", {
                  sessionId: this.sessionId,
                  update: { sessionUpdate: "usage_update", used: usedTokens, size: windowSize },
                });
              }
            }
          }
          if (res?.status === "ERROR") {
            pending.reject(new Error(res.error || "Antigravity reported an error"));
          } else {
            const u = pending.usage;
            if (u.totalTokens > 0) {
              process.stderr
                .write(`[agy] turn complete in=${u.inputTokens} out=${u.outputTokens} thinking=${u.thoughtTokens} total=${u.totalTokens}
`);
            }
            this.lastUsage = { ...pending.usage };
            pending.resolve({
              stopReason: "end_turn",
              usage: pending.usage,
            });
          }
        })();
      }
    }
  }
  private executePrompt(
    id: number | string,
    promptText: string,
    retryAllowed = true
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      void (async () => {
        const useStdin = await this.probeSupportsInputFormat();
        if (!useStdin) {
          process.stderr.write(
            "[agy] Antigravity running in compatibility mode (per-turn CLI invocation)\n"
          );
        }
        const proc = useStdin ? this.ensureAgyProc() : this.ensureAgyProc(["-p", promptText]);
        this.pendingPrompt = {
          id,
          resolve: (val) => {
            this.sendResponse(id, val);
            resolve();
          },
          reject: (err) => {
            const errMsg = (err as Error).message || "";
            const combinedErr = errMsg + "\n" + this.lastStderrBuffer.join("\n");
            if (retryAllowed) {
              if (/requires --effort/i.test(combinedErr)) {
                this.effortRequirementOverrides.set(this.currentModelId, true);
                this.killAgyProc();
                this.executePrompt(id, promptText, false).then(resolve, reject);
                return;
              } else if (/conflicts with --effort/i.test(combinedErr)) {
                this.effortRequirementOverrides.set(this.currentModelId, false);
                this.killAgyProc();
                this.executePrompt(id, promptText, false).then(resolve, reject);
                return;
              }
            }
            this.sendError(id, -32603, errMsg || "Prompt error");
            reject(err instanceof Error ? err : new Error(String(err)));
          },
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            thoughtTokens: 0,
            totalTokens: 0,
          },
        };
        if (useStdin) {
          const payload =
            JSON.stringify({
              event: "user",
              message: {
                role: "user",
                content: promptText,
              },
            }) + "\n";
          proc.stdin.write(payload, (err) => {
            if (err) {
              this.pendingPrompt = undefined;
              this.sendError(
                id,
                -32603,
                `Failed to write prompt to Antigravity stdin: ${err.message}`
              );
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          });
        }
      })();
    });
  }
}
