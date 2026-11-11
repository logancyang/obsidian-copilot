import { requireNodeModule } from "@/utils/desktopRuntime";

export const COPILOT_ACP_ENV = "OBSIDIAN_COPILOT_ACP";

const HOOK_GROUP = "copilot-no-late-work";
const AGENT_DIR = ".agent";
const HOOKS_FILE = "hooks.json";
const SCRIPT_FILE = "copilot-guard.sh";
const SCRIPT_HEADER = "#!/bin/sh\n# Written by Obsidian Copilot.";
const STOP_WAIT_SECONDS = 30;

const DENY_REASON =
  "Not available in this chat: subagents, swarms, workflows, timers and scheduled tasks are disabled because their results would arrive after the turn ends and never be shown. Do the work yourself in this turn, or tell the user it is not available here.";

const CONTINUE_REASON =
  "Something you started is still running in the background. This chat cannot show anything that finishes after your turn ends, so do not end the turn yet. Check it once with manage_task. If it has finished, report the result. If it will finish soon, end your reply attempt and you will be asked again. If it is meant to keep running (a server, a watcher, a long job), stop it with manage_task (Action kill) and tell the user that background work is not available in this chat.";

const HOOKS_TEXT = `${JSON.stringify(
  {
    [HOOK_GROUP]: {
      PreToolUse: [
        {
          matcher:
            "^(invoke_subagent|define_subagent|manage_subagents|schedule|swarm|send_message|run_workflow)$",
          hooks: [{ type: "command", command: `sh ./${SCRIPT_FILE} deny`, timeout: 10 }],
        },
      ],
      Stop: [{ type: "command", command: `sh ./${SCRIPT_FILE} stop`, timeout: 60 }],
    },
  },
  null,
  2
)}\n`;

const SCRIPT_TEXT = [
  SCRIPT_HEADER,
  `# Acts only in agy processes Copilot starts with ${COPILOT_ACP_ENV}=1; Copilot rewrites this file.`,
  "input=$(cat)",
  `if [ "$${COPILOT_ACP_ENV}" != "1" ]; then`,
  `  if [ "$1" = "stop" ]; then echo '{}'; else echo '{"decision":"allow"}'; fi`,
  "  exit 0",
  "fi",
  'case "$1" in',
  "  deny)",
  `    echo '${JSON.stringify({ decision: "deny", reason: DENY_REASON })}'`,
  "    ;;",
  "  stop)",
  '    case "$input" in',
  `      *'"terminationReason":"NO_TOOL_CALL"'*) ;;`,
  "      *) echo '{}'; exit 0 ;;",
  "    esac",
  '    case "$input" in',
  `      *'"fullyIdle":false'*)`,
  `        sleep ${STOP_WAIT_SECONDS}`,
  `        echo '${JSON.stringify({ decision: "continue", reason: CONTINUE_REASON })}'`,
  "        ;;",
  "      *) echo '{}' ;;",
  "    esac",
  "    ;;",
  "  *) echo '{}' ;;",
  "esac",
  "",
].join("\n");

function hooksWrittenByCopilot(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as unknown;
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).join() === HOOK_GROUP
    );
  } catch {
    return false;
  }
}

function scriptWrittenByCopilot(text: string): boolean {
  return text.startsWith(SCRIPT_HEADER);
}

export async function installAntigravityLateWorkGuard(
  vaultBasePath: string,
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  if (platform === "win32") {
    throw new Error(
      "Antigravity chats aren't available on Windows yet: Copilot can't yet stop Antigravity there from starting subagents and background tasks whose results would never reach the chat."
    );
  }
  const fs = requireNodeModule<typeof import("node:fs")>("fs").promises;
  const path = requireNodeModule<typeof import("node:path")>("path");
  const dir = path.join(vaultBasePath, AGENT_DIR);
  const files = [
    { name: HOOKS_FILE, text: HOOKS_TEXT, ours: hooksWrittenByCopilot },
    { name: SCRIPT_FILE, text: SCRIPT_TEXT, ours: scriptWrittenByCopilot },
  ];
  const current = await Promise.all(
    files.map(({ name }) =>
      fs
        .readFile(path.join(dir, name), "utf8")
        .catch((error: NodeJS.ErrnoException) =>
          error.code === "ENOENT" ? null : Promise.reject(error)
        )
    )
  );
  const foreign = files.find(
    (file, index) => current[index] !== null && !file.ours(current[index])
  );
  if (foreign) {
    throw new Error(
      `Antigravity can't start in this vault: ${AGENT_DIR}/${foreign.name} was not written by Copilot. Copilot needs its own copy there to stop Antigravity from starting subagents and background tasks whose results would never reach the chat. Move the file out of ${AGENT_DIR}, then start a new chat.`
    );
  }
  await fs.mkdir(dir, { recursive: true });
  await Promise.all(
    files
      .filter((file, index) => current[index] !== file.text)
      .map((file) => fs.writeFile(path.join(dir, file.name), file.text))
  );
}
