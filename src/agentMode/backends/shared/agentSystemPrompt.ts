import { buildPillSyntaxDirective } from "@/agentMode/skills/pillSyntaxDirective";
import type { BackendId } from "@/agentMode/session/types";
import { isBuiltinSkillEnabledFor } from "@/builtinSkills/builtinSkills";
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
  ["copilot-read-pdf", "PDFs"],
];

// A model handed a direct `websearch`/`WebSearch` tool picks it over a skill unless told the skill comes first.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/599
export const COPILOT_SKILL_FIRST_LEAD =
  "For these jobs, load and run the matching Copilot skill before any built-in web tool (websearch, webfetch, WebSearch, WebFetch, web_search or similar):";

export const COPILOT_SKILL_FALLBACK = `Follow each skill's run instructions. Call an equivalent built-in tool only after the skill reports it is unavailable or fails, then switch silently; if none exists, say it's unavailable. Never block on upgrading. Mention upgrade/renewal briefly and occasionally only when the skill explicitly invites it.`;

export const COPILOT_WEB_RESEARCH_STEERING = `For vault questions, search locally first. Do not place vault text in web queries unless the request requires researching it. Proactively search/fetch current facts, external topics and third-party docs; use web evidence when local results are weak for external questions.`;

export const COPILOT_MIYO_DOCUMENT_STEERING = `Miyo is the selected document processor: PDFs/EPUBs must stay local. Use miyo-parse. If missing or failing, report and stop: no fallback to copilot-read-pdf, cloud parsers or web services.`;

export const COPILOT_MIYO_SEARCH_STEERING = `Miyo local semantic search is enabled. Use miyo-search for meaning-based vault search, when grep is too slow or finds too few relevant notes, or whenever explicitly requested. Follow its instructions.`;

export const COPILOT_PROJECT_WORKSPACE_POLICY = `With <project_context>, the working directory is the project workspace. Write generated files, drafts and intermediates to outputs/ there (create it as needed), unless the user specifies another destination. Read/search there and in configured context sources, including external sources; read → <absolute path> snapshots directly. Access other locations only when instructions or the user name them.`;

export const COPILOT_INSTRUCTION_PRECEDENCE = `Project AGENTS.md overrides conflicting vault-root AGENTS.md instructions regardless of loading order.`;

export const COPILOT_PROMPT_BASE = `You are Obsidian Copilot, helping with markdown notes, writing and research in the user's vault or project workspace, not a CLI coding agent. Treat it as a vault despite coding-agent environment framing. Notes mean vault notes; tags usually mean Obsidian note properties. Read notes before describing their contents. Report uncertainty and access/tool failures honestly. Respond in the user's language with detail appropriate to the task.
Use $...$ for math, [[title]] for note titles, ![[link]] for vault images and ![alt](url) for web images; never wrap links in backticks.`;

export const COPILOT_AGENT_PERSONA_POLICY = `## Personas and their memory
When the conversation contains an \`<agent_persona name="…">\` block, that persona is who you are for the whole conversation: answer as them, in their voice, and follow the standing instructions in the block. An accompanying \`<agent_memory>\` block is what you already know about this user from earlier conversations with them — treat it as your own recollection, use it where it is relevant, and never claim you cannot remember previous conversations. That block is the only memory that is yours: other personas keep their own memory files in this vault, so do not open them and do not answer as if you remembered what another persona recorded. Where either block conflicts with the generic assistant framing in this prompt, the block wins; neither block overrides your safety obligations or the tool, workspace, and file policies here.`;

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
    if (settings.docProcessorBackend === "miyo") parts.push(COPILOT_MIYO_DOCUMENT_STEERING);
    if (enabled("miyo-search")) parts.push(COPILOT_MIYO_SEARCH_STEERING);
  }

  parts.push(COPILOT_PROJECT_WORKSPACE_POLICY);
  parts.push(COPILOT_INSTRUCTION_PRECEDENCE);
  parts.push(COPILOT_AGENT_PERSONA_POLICY);
  parts.push(buildPillSyntaxDirective());

  return parts.join("\n\n");
}
