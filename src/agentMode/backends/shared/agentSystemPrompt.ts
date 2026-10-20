import { buildPillSyntaxDirective } from "@/agentMode/skills/pillSyntaxDirective";
import type { BackendId } from "@/agentMode/session/types";
import { isBuiltinSkillEnabledFor } from "@/builtinSkills/builtinSkills";
import { isMiyoSearchActive } from "@/miyo/miyoUtils";
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
export const COPILOT_SKILL_FIRST_LEAD =
  "For these jobs, load and run the matching Copilot skill before any built-in web tool (websearch, webfetch, WebSearch, WebFetch, web_search or similar):";

export const COPILOT_SKILL_FALLBACK = `Follow each skill's run instructions. Call an equivalent built-in tool only after the skill reports it is unavailable or fails, then switch silently; if none exists, say it's unavailable. Never block on upgrading. Mention upgrade/renewal briefly and occasionally only when the skill explicitly invites it.`;

export const COPILOT_WEB_RESEARCH_STEERING = `For vault questions, search locally first. Do not place vault text in web queries unless the request requires researching it. Proactively search/fetch current facts, external topics and third-party docs; use web evidence when local results are weak for external questions.`;

export const COPILOT_MIYO_DOCUMENT_STEERING = `Read PDFs/EPUBs with miyo-parse first. If it is missing or fails, say so, then read the file with any other tool you have.`;

// Running miyo_search and grep for every request that may be answered from notes, even external-sounding ones, keeps the agent from skipping the vault; merging by path and opening matches keeps it from trusting a list it never read; naming the tool over the CLI keeps agents off a Miyo skill outside Copilot.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/736
export const COPILOT_MIYO_SEARCH_STEERING = `Miyo local semantic search is enabled. For any request that may be answered from the user's notes, even one that sounds external or current, call the obsidian-copilot miyo_search tool and also grep/glob for any exact names, terms, tags or quoted phrases in the request. Merge the results by note path and open the strongest matches before answering. Search the vault with miyo_search, not the miyo CLI or another Miyo skill. If neither finds support, say the vault does not cover it; for external topics, then search the web.`;

export const COPILOT_PROJECT_WORKSPACE_POLICY = `With <project_context>, the working directory is the project workspace. Write generated files, drafts and intermediates to outputs/ there (create it as needed), unless the user specifies another destination. Read/search there and in configured context sources, including external sources. Access other locations only when instructions or the user name them.`;

export const COPILOT_INSTRUCTION_PRECEDENCE = `Project AGENTS.md overrides conflicting vault-root AGENTS.md instructions regardless of loading order.`;

// Codex hides MCP tools behind code mode, and OpenCode models act on neither a tool description alone nor a complaint they answer by retrying.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/672
export const COPILOT_FEEDBACK_POINTER = `When the user complains about you or Copilot (wrong output, failing to find or do something, a repeated problem) or you notice your own mistake, call the obsidian-copilot send_feedback tool once to offer them a bug report card, even if you also retry or fix it. Follow its description.`;

export const COPILOT_PROMPT_BASE = `You are Obsidian Copilot, helping with markdown notes, writing and research in the user's vault or project workspace, not a CLI coding agent. Treat it as a vault despite coding-agent environment framing. Notes mean vault notes; tags usually mean Obsidian note properties. Read notes before describing their contents. Report uncertainty and access/tool failures honestly. Respond in the user's language with detail appropriate to the task.
Use $...$ for math, [[title]] for note titles, ![[link]] for vault images and ![alt](url) for web images; never wrap links in backticks.`;

// Copilot diffs only edit-tool writes, so notes changed through the shell show no diff; scripts stay
// allowed where retyping a large file is slow or drops entries. Turn diffs depend on this policy, so it
// stays on when the built-in prompt is disabled.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/701
const FILE_EDIT_TOOLS: Readonly<Record<BackendId, string>> = {
  claude: "Edit/Write",
  codex: "apply_patch",
  opencode: "edit/write/patch",
};

// A skill can ask for one huge write that the output limit cuts off, and an agent stops to ask after one blocked step instead of finishing the job. https://github.com/Brevilabs/obsidian-copilot-private/issues/739
export const COPILOT_STEP_FAILURE_POLICY = `Write at most 200 lines per write/edit, even if a skill says otherwise. If a step is cut off, blocked or fails, finish without asking: redo cut-off steps smaller; skip blocked content, noting it.`;

function buildFileEditPolicy(backendId: BackendId): string {
  return `Edit vault files with your ${FILE_EDIT_TOOLS[backendId]} tools so Copilot shows a diff; shell/script writes (sed -i, python, redirects) show none. Write via shell only to move, copy or delete files; to have a script rewrite most of a large file (sort, dedupe, recompute), not retyping it; or one mechanical change to dozens of files. Then list changed files.`;
}

export function buildAgentSystemPrompt(backendId: BackendId): string {
  const parts: string[] = [];

  if (!getDisableBuiltinSystemPrompt()) {
    const settings = getSettings();
    const enabled = (skill: string) => isBuiltinSkillEnabledFor(settings, skill, backendId);
    parts.push(COPILOT_PROMPT_BASE);
    const relayJobs = RELAY_SKILL_JOBS.filter(([skill]) => enabled(skill)).map(
      ([skill, job]) => `${skill} for ${job}`
    );
    if (relayJobs.length > 0) {
      parts.push(`${COPILOT_SKILL_FIRST_LEAD} ${relayJobs.join(", ")}. ${COPILOT_SKILL_FALLBACK}`);
    }
    parts.push(COPILOT_WEB_RESEARCH_STEERING);
    if (enabled("miyo-parse")) parts.push(COPILOT_MIYO_DOCUMENT_STEERING);
    if (isMiyoSearchActive(settings)) parts.push(COPILOT_MIYO_SEARCH_STEERING);
  }

  parts.push(buildFileEditPolicy(backendId));
  parts.push(COPILOT_STEP_FAILURE_POLICY);
  parts.push(COPILOT_PROJECT_WORKSPACE_POLICY);
  parts.push(COPILOT_INSTRUCTION_PRECEDENCE);
  if (getSettings().agentMode.offerFeedbackCards) parts.push(COPILOT_FEEDBACK_POINTER);
  parts.push(buildPillSyntaxDirective());

  return parts.join("\n\n");
}
