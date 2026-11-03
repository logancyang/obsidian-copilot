import {
  type ObsidianCliProcessResult,
  runObsidianCliArgs,
} from "@/services/obsidianCli/ObsidianCliClient";
import { resolveObsidianCliPath } from "@/services/obsidianCli/obsidianCliPath";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { err2String } from "@/utils";

export const OBSIDIAN_CLI_TOOL_NAME = "obsidian_cli";

// Codex cuts the middle out of any MCP output over about 40,000 UTF-8 bytes, so long listings end at a marked cut instead.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/833
const OUTPUT_BUDGET_BYTES = 32_000;

export const OBSIDIAN_CLI_TOOL = Object.freeze({
  name: OBSIDIAN_CLI_TOOL_NAME,
  description: `Run an Obsidian CLI command in the running Obsidian app, on the user's vault (Copilot sets vault=). Use it for live app state and Obsidian's index and settings: open tabs (tabs ids), daily notes (daily:path, daily:read, daily:append), typed properties (property:set with type=), tasks, links (backlinks, links, unresolved, orphans), Bases (base:query format=json), templates (create path=<note> template=<name> fills {{title}} with the new file name without extension and {{date}}/{{time}} with now), link-aware move and rename, and plugin commands (commands filter=<prefix>, then command id=<id>). Use ordinary file tools for plain reads, writes and text search.
Pass the command and each name=value parameter as separate args, e.g. ["backlinks", "path=Projects/Plan.md", "format=json"]; flags take no value. Call ["help", "<command>"] for a command's exact parameters. Use path= for an exact vault path and file= for wikilink-style name lookup.
Never reload or restart Obsidian, or reload, disable or uninstall Copilot, including through command, eval or dev:cdp: that ends this chat. Delete permanently, restore history, install or uninstall plugins or themes, or change app state with eval only when the user asked for exactly that.`,
  inputSchema: {
    type: "object",
    properties: {
      args: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        description: "The command, then its parameters.",
      },
    },
    required: ["args"],
  },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
});

export const OBSIDIAN_CLI_TURNED_OFF_TEXT = `${OBSIDIAN_CLI_TOOL_NAME} is not available because Obsidian's Command line interface setting (Settings → General) is off. Tell the user if the request needs the running app; don't call it again.`;

export interface ObsidianCliToolResult {
  text: string;
  isError: boolean;
}

export interface ObsidianCliToolDeps {
  getVaultName: () => string;
  hostPluginId: string;
  run: (command: string, args: string[]) => Promise<ObsidianCliProcessResult>;
}

export function createObsidianCliCall(
  deps: ObsidianCliToolDeps
): (input: unknown) => Promise<ObsidianCliToolResult> {
  return async (input) => {
    const raw = (input as { args?: unknown } | null)?.args;
    if (!Array.isArray(raw) || raw.length === 0 || raw.some((arg) => typeof arg !== "string")) {
      return { text: "args must be a non-empty array of strings.", isError: true };
    }
    // The CLI only honors a leading vault=, so an agent's own vault= would be read as the command; Copilot always targets its vault.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/833
    const args = (raw as string[]).filter((arg) => !arg.startsWith("vault=")).map(unquoteValue);
    const [command] = args;
    if (!command) return { text: "args must start with a command.", isError: true };
    if (endsHostSession(args, deps.hostPluginId)) {
      return {
        text: `Refused: ${args.join(" ")} would reload Obsidian or turn off Copilot and end this chat. Tell the user to do it themselves after the chat if it is needed.`,
        isError: true,
      };
    }

    let result: ObsidianCliProcessResult;
    try {
      result = await deps.run(command, [`vault=${deps.getVaultName()}`, ...args]);
    } catch (error) {
      return { text: `The Obsidian CLI could not run: ${err2String(error)}`, isError: true };
    }
    const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
    if (result.ok) return { text: withinBudget(output || "(no output)"), isError: false };
    const status = result.exitCode ?? result.signal ?? result.errorCode;
    return {
      text: withinBudget(`The Obsidian CLI failed (${String(status)}). ${output}`.trim()),
      isError: true,
    };
  };
}

export async function runInRunningObsidian(
  command: string,
  args: string[]
): Promise<ObsidianCliProcessResult> {
  const binary = resolveObsidianCliPath({
    platform: process.platform,
    resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
    homeDir: requireNodeModule<typeof import("node:os")>("os").homedir(),
  });
  return await runObsidianCliArgs(command, args, { binary: binary ?? undefined });
}

// Agents copy shell syntax (name="My Note"), but args reach the CLI without a shell, so the quotes would become part of the value.
// A value that repeats its outer quote inside (code='a' + 'b') is content, not shell quoting, and stays intact.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/833
function unquoteValue(arg: string): string {
  return arg.replace(/^([^=\s]+)=(?:"([^"]*)"|'([^']*)')$/, "$1=$2$3");
}

// Reloading the app or turning off Copilot kills the agent mid-turn and can discard its work.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/833
function endsHostSession([command, ...params]: string[], hostPluginId: string): boolean {
  switch (command) {
    case "reload":
    case "restart":
      return true;
    case "plugins:restrict":
      return params.includes("on");
    case "plugin:disable":
    case "plugin:reload":
    case "plugin:uninstall":
      return params.includes(`id=${hostPluginId}`);
    case "command":
      return params.includes("id=app:reload");
    default:
      return false;
  }
}

function withinBudget(text: string): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= OUTPUT_BUDGET_BYTES) return text;
  const cut = new TextDecoder().decode(bytes.slice(0, OUTPUT_BUDGET_BYTES)).replace(/�$/, "");
  return `${cut}\n\n[Output cut at ${OUTPUT_BUDGET_BYTES} bytes. Narrow the command, e.g. with folder=, path= or total.]`;
}
