import type { BuiltinSkill } from "./builtinSkills";

const SCREENPIPE_ACTIVITY_VERSION = 1;

/** Optional activity-history guidance for agents with a configured local screenpipe MCP server. */
export const SCREENPIPE_ACTIVITY_SKILL: BuiltinSkill = {
  name: "screenpipe-activity",
  version: SCREENPIPE_ACTIVITY_VERSION,
  enabledAgents: [],
  skillMd: `---
name: screenpipe-activity
description: Search the user's screenpipe screen and audio history when they ask what they saw, heard, typed, or worked on during a time range. Use only when a screenpipe MCP server is already configured. Do not use for ordinary vault questions or install screenpipe automatically.
metadata:
  copilot-enabled-agents: ""
  copilot-builtin-version: "${SCREENPIPE_ACTIVITY_VERSION}"
---

# Search activity with screenpipe

Use this skill only when screenpipe MCP tools are already available to the
current agent. screenpipe records on the user's computer when they install and
enable it. This skill does not install screenpipe, start recording, change its
retention settings, or copy activity into the Obsidian vault.

If no screenpipe tools appear in the current tool catalog, stop and explain
that the user must connect screenpipe to this agent first. Link to
https://docs.screenpipe.com/mcp-server. Do not edit an agent configuration or
run an installer unless the user explicitly asks.

## Query the smallest useful range

1. Translate the requested period into explicit ISO 8601 start and end times.
   If the period is ambiguous, state the interpretation before searching.
2. Call screenpipe's \`search-content\` tool with a limit no greater than 20.
   Start with \`content_type=all\` for a broad recap, \`audio\` for spoken
   conversation, or \`input\` only when the user explicitly asks about text they
   typed or copied.
3. Keep \`include_frames\` false unless the request needs visual detail that the
   captured text cannot answer. A screenshot can contain unrelated private
   information.
4. For audio, begin without a keyword when a time range or speaker is enough.
   Transcription errors can make a keyword-only query miss relevant speech.
5. Narrow the range or page with \`offset\` if the first result set is too broad.
   Do not raise the result limit above 20 or dump raw result sets into the chat.

An empty result is inconclusive. Check whether screenpipe is running and
recording, broaden the range once when appropriate, and otherwise say that no
matching capture was available. Do not turn an incomplete read into a claim
that the user had no activity.

## Answer with traceable evidence

- Prefer a concise synthesis over raw captured text.
- Ground material claims in returned timestamps, app or window names, and
  speaker labels when present. Separate captured facts from inference.
- Link to a screenpipe frame or timeline moment only when the result provides
  the real frame ID or timestamp. Never invent an identifier.
- Do not convert frame or result counts into time spent. Capture is
  event-driven, so counts measure capture volume rather than duration.
- Mention relevant coverage gaps, transcription uncertainty, or recording
  health when they affect the answer.

## Keep side effects explicit

Searching is read-only. Do not call \`export-video\`, control another app, create
or update an Obsidian note, save a memory, or share captured data unless the
user explicitly requests that separate action. Before an export, confirm the
requested time range and destination. Send only the smallest relevant excerpts
to the active model because that model may run outside the user's computer.
`,
  files: [],
};
