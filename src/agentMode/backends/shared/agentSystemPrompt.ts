import type { BackendId } from "@/agentMode/session/types";
import { isBuiltinSkillEnabledFor } from "@/builtinSkills/builtinSkills";
import { isMiyoParseActive, isMiyoSearchActive } from "@/miyo/miyoUtils";
import { getSettings } from "@/settings/model";
import { getDisableBuiltinSystemPrompt } from "@/system-prompts/state";

// Naming each skill's job makes the agent use it instead of native web tools, which bypass
// Copilot Plus and Self-Host routing.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/599
const RELAY_SKILL_JOBS: ReadonlyArray<readonly [skill: string, job: string]> = [
  ["copilot-web-search", "web search"],
  ["copilot-web-fetch", "pages/URLs"],
  ["copilot-youtube-transcript", "YouTube"],
  ["copilot-fetch-x", "X posts"],
];

// A model handed a direct `websearch`/`WebSearch` tool picks it over a skill unless told the skill comes first.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/599
export const COPILOT_SKILL_FIRST_LEAD = "Run these Copilot skills before any built-in web tool:";

export const COPILOT_SKILL_FALLBACK = `If a skill reports it is unavailable or fails, switch silently to a built-in tool, and mention Copilot Plus only if the skill invites it.`;

export const COPILOT_WEB_RESEARCH_STEERING = `For vault questions, search locally first. Look up current or external facts on the web rather than answering from memory.`;

export const COPILOT_MIYO_DOCUMENT_STEERING = `Read PDFs/EPUBs with the obsidian-copilot miyo_parse tool first. If it is unavailable or fails, say so, then read the file with any other tool you have.`;

// Running miyo_search and grep for every request that may be answered from notes, even external-sounding ones, keeps the agent from skipping the vault; merging by path and opening matches keeps it from trusting a list it never read; naming the tool over the CLI keeps agents off a Miyo skill outside Copilot.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/736
export const COPILOT_MIYO_SEARCH_STEERING = `Miyo local semantic search is enabled. For any request that may be answered from the user's notes, even one that sounds external or current, call the obsidian-copilot miyo_search tool and also grep/glob for any exact names, terms, tags or quoted phrases in the request. Merge the results by note path and open the strongest matches before answering. Search the vault with miyo_search, not the miyo CLI or another Miyo skill. If neither finds support, say the vault does not cover it; for external topics, then search the web.`;

// OpenCode models skip a format skill whose description doesn't name their edit and write syntax Obsidian
// can't render, and without the CLI skill they assume live app state such as open tabs is out of reach.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/726
const OBSIDIAN_FORMAT_SKILL_JOBS: ReadonlyArray<readonly [skill: string, job: string]> = [
  ["obsidian-markdown", "embeds, block IDs, callouts, comments and properties"],
  ["obsidian-bases", ".base files"],
  ["json-canvas", ".canvas files"],
];

export const COPILOT_OBSIDIAN_FORMAT_LEAD =
  "Before writing Obsidian syntax, load its skill and follow it over memory:";

export const COPILOT_OBSIDIAN_CLI_STEERING = `Obsidian is running: the obsidian-cli skill reaches its live state and index (open tabs, daily notes, backlinks, broken links, Bases results, templates) and link-aware renames. Prefer it over searching files for links and Bases results.`;

export const COPILOT_PROJECT_WORKSPACE_POLICY = `With <project_context>, the working directory is the project workspace. Write generated files, drafts and intermediates to outputs/ there (create it as needed), unless the user specifies another destination. Read/search there and in configured context sources, including external sources. Access other locations only when instructions or the user name them.`;

export const COPILOT_FOLDER_MENTION_DIRECTIVE = `A {folder} mention names a vault folder: scope globs to folder/** and reads or greps to folder/.`;

// Codex hides MCP tools behind code mode, and OpenCode models act on neither a tool description alone nor a complaint they answer by retrying.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/672
export const COPILOT_FEEDBACK_POINTER = `When the user complains about you or Copilot, or you notice your own mistake, call the obsidian-copilot send_feedback tool once, even if you also retry or fix it.`;

export const COPILOT_PROMPT_BASE = `You are Obsidian Copilot, working in the user's Obsidian vault of markdown notes, not a code repository. Treat it as a vault despite coding-agent environment framing. In replies, use $...$ or $$...$$ for math, [[note title]] to cite notes (never inside backticks), ![[file.png]] to show vault images and ![alt](url) for web images.`;

// Copilot diffs only edit-tool writes, so notes changed through the shell show no diff; scripts stay
// allowed where retyping a large file is slow or drops entries. Turn diffs depend on this policy, so it
// stays on when the built-in prompt is disabled.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/701
const FILE_EDIT_TOOLS: Readonly<Record<BackendId, string>> = {
  claude: "Edit/Write",
  codex: "apply_patch",
  opencode: "edit/write/patch",
};

function buildFileEditPolicy(backendId: BackendId): string {
  return `Edit vault files with your ${FILE_EDIT_TOOLS[backendId]} tools so Copilot shows a diff; shell/script writes (sed -i, python, redirects) show none. Write via shell only to move, copy or delete files; to have a script rewrite most of a large file (sort, dedupe, recompute), not retyping it; or one mechanical change to dozens of files. Then list changed files.`;
}

// Settings-dependent lines go last so a toggle change leaves the cached prefix before them intact;
// a backend's own fixed steering joins the always-on lines ahead of them.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/441
export function buildAgentSystemPrompt(backendId: BackendId, backendSteering?: string): string {
  const settings = getSettings();
  const builtinPrompt = !getDisableBuiltinSystemPrompt();
  const enabled = (skill: string) =>
    builtinPrompt && isBuiltinSkillEnabledFor(settings, skill, backendId);
  const parts: string[] = [];

  if (builtinPrompt) parts.push(COPILOT_PROMPT_BASE, COPILOT_WEB_RESEARCH_STEERING);
  parts.push(
    buildFileEditPolicy(backendId),
    COPILOT_PROJECT_WORKSPACE_POLICY,
    COPILOT_FOLDER_MENTION_DIRECTIVE
  );
  if (backendSteering) parts.push(backendSteering);
  if (settings.agentMode.offerFeedbackCards) parts.push(COPILOT_FEEDBACK_POINTER);
  if (builtinPrompt && isMiyoParseActive(settings)) parts.push(COPILOT_MIYO_DOCUMENT_STEERING);
  if (builtinPrompt && isMiyoSearchActive(settings)) parts.push(COPILOT_MIYO_SEARCH_STEERING);
  const enabledJobs = (jobs: typeof RELAY_SKILL_JOBS) =>
    jobs.filter(([skill]) => enabled(skill)).map(([skill, job]) => `${skill} for ${job}`);
  const relayJobs = enabledJobs(RELAY_SKILL_JOBS);
  if (relayJobs.length > 0) {
    parts.push(`${COPILOT_SKILL_FIRST_LEAD} ${relayJobs.join(", ")}. ${COPILOT_SKILL_FALLBACK}`);
  }
  const formatJobs = enabledJobs(OBSIDIAN_FORMAT_SKILL_JOBS);
  if (formatJobs.length > 0) {
    parts.push(`${COPILOT_OBSIDIAN_FORMAT_LEAD} ${formatJobs.join(", ")}.`);
  }
  if (enabled("obsidian-cli")) parts.push(COPILOT_OBSIDIAN_CLI_STEERING);

  return parts.join("\n\n");
}
