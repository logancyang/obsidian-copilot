# Custom Agents: named personas with self-maintained memory

Product design for letting a user build a small team of named agents inside
Agent Mode. Each agent has its own instructions and its own memory file that it
updates after every conversation. The user talks to one agent at a time in a
DM-style chat, and can pull several agents into one turn through fan-out, which
this replaces wholesale: an agent becomes the only kind of fan-out answerer.
Written to be handed to an implementing agent as the source of truth for scope,
behavior, and file layout.

## Why

Today every Agent Mode chat talks to the same anonymous assistant. It has a fixed
product prompt, whatever instructions sit in `AGENTS.md`, and no memory. Each new
chat starts from zero. Users who want a differently-behaved assistant for a
different kind of task have one lever, the vault-wide instruction file, and it
applies to everything.

Products like Raft show that people enjoy owning and maintaining an agent team.
The instinct is natural: different tasks want different specialists, each with
its own voice, its own standing instructions, and its own opinion. The part that
makes a named agent feel like a colleague rather than a prompt preset is memory.
When an agent remembers what you told it last week without being asked, the
relationship compounds.

Copilot is unusually well placed to offer this cheaply:

- Agent Mode already runs three coding-agent harnesses (Claude Code, Codex,
  OpenCode) behind one chat surface. A persona is harness-independent, so a team
  can mix harnesses and the user never has to think about it.
- Fan-out already lets one turn go to several answerers in parallel with the
  session's own agent summarizing. The machinery is built; only the answerer
  type changes. Swapping backend brands for agents turns "ask three models" into
  "ask my team", which is the version anyone actually wants.
- Everything is markdown in the vault. An agent's instructions and memory are
  ordinary notes the user can open, edit, search, and sync.

We are deliberately not building an autonomous multi-agent system. Agents do not
talk to each other, do not interrupt, and do not take a turn unless the user
addresses them. The user always chooses who is in the conversation and who
answers. Fan-out is the collaboration primitive, and it is enough.

## What we are building

Three user-facing pieces, shipped in this order.

1. **An Agents tab in Settings** to create, edit, and delete agents. Creating one
   materializes a folder under `copilot/agents/<slug>/`.
2. **A "talking to" selector in the agent chat** so a DM-style chat is held with
   one chosen agent, whose instructions and memory ride along, and whose memory
   is updated when the conversation ends.
3. **Agent fan-out, replacing today's fan-out entirely.** `@Jennifer @Vancat
compare these two drafts` sends the same prompt to both, each answering in
   character with its own memory, and the session's agent summarizes. The
   backend-brand answerers (`@claude`, `@codex`, `@opencode`) are removed in the
   same change, not kept alongside.

### Non-goals for v1

- Agents proactively joining or interrupting a conversation.
- Agent-to-agent conversation, debate rounds, or shared memory.
- Memory search, embeddings, or per-message memory. One markdown file per agent.
- Migrating the legacy Chat-mode memory (`memory/Recent Conversations.md`).
- Mobile. Agent Mode is desktop-only and this inherits that.

## How it works

### 1. Agents live in the vault

```text
copilot/agents/
  jennifer/
    agent.md      identity + instructions, user-owned, never rewritten by Copilot
    MEMORY.md     self-maintained by the agent, user may edit or clear
  vancat/
    agent.md
    MEMORY.md
```

`agent.md` has a small frontmatter record and a markdown body that is the
persona's standing instructions:

```markdown
---
copilot-agent-name: Jennifer
copilot-agent-description: Skeptical editor. Cuts fluff, argues for the reader.
copilot-agent-icon: 🪶
copilot-agent-backend: claude # optional; omit to use the session's backend
copilot-agent-model: # optional; omit to use the backend's default
copilot-agent-effort: # optional; omit to use the session's effort
copilot-agent-memory: true
copilot-agent-created: 2026-09-16T10:00:00Z
---

You are Jennifer, a developmental editor. You care about the reader more than
the author. Push back on vague claims. Prefer short sentences. ...
```

Rules, mirroring how projects and `AGENTS.md` already work:

- The folder name is the slug. The slug is the stable id used in chat
  frontmatter and in `@` mentions. Renaming the display name does not move the
  folder.
- `agent.md` and `MEMORY.md` are excluded from retrieval and semantic search,
  the same way `AGENTS.md` is, because the agent already receives them.
- The `agents` subfolder is a new entry in `COPILOT_SUBFOLDER` and derives from
  the single configurable Copilot root like every other subfolder. No new
  setting for its path.
- Deleting an agent moves the folder to trash with a confirm dialog that
  mentions the memory file will go with it.
- Existing chats that referenced a deleted agent still open. The chat shows the
  agent name as a plain label and the session runs as the default assistant.

### 2. The default assistant is an agent too

The picker always contains one built-in entry, **Copilot**, which is exactly
today's behavior: product prompt plus `AGENTS.md`, no persona body, no memory.
It cannot be deleted or edited. New users see "Copilot" selected and nothing
else, so the feature is invisible until they create an agent.

### 3. Choosing who you are talking to

The agent is chosen inside the model picker popover in the chat composer,
not from a separate control. The popover opens with an **Agent** section at
the top holding one select row: the current agent's icon and name, the
built-in **Copilot** by default, with a chevron. Activating the row opens a
nested list of Copilot and every custom agent with icon, name, and
description, a checkmark on the current one, and a search field once there
are more than six entries. Choosing an entry closes the list and updates the
row; the model and effort sections below never move. A divider follows the
Agent section, and below it sit today's model and effort sections unchanged.
People are expected to keep five to ten agents, so the roster never renders
inline in the popover.

Picking an agent that pins a backend, model, or effort switches the model and
effort sections to those values at once, so the composer's trigger reflects
what the agent will actually run on. An agent with no pins leaves the current
model and effort alone. The user can still change model or effort after
picking an agent; the pins are a starting point, not a lock.

The section is a chooser and nothing else. An agent's memory actions live on
its row in Settings, where the agent is edited, and the chat tab menu keeps
"Update memory now" for the chat in front of the user; a list of who can
answer is not the place for file actions.

The composer's trigger keeps reading as the model and effort alone. The chat
tab already carries the agent's icon and name, and in a sidebar narrow enough
to matter the agent's name would push the model out of the trigger entirely —
which is the one thing the trigger exists to say.

Choosing an agent applies to the _next_ new chat and to any chat that has not
yet sent a message. A chat that already has messages keeps the agent it
started with. The active chat tab shows the agent's icon and name so the user
always knows who is answering. There is no agent control in the Agent Home
header.

Scope and agent are orthogonal. You can DM Jennifer at the vault root or inside
a project. The working directory, project context block, and Recent Chats
scoping are unchanged. The agent only changes what is said to the model.

### 4. How the persona reaches the model

The product prompt stays byte-identical everywhere. That rule is what makes the
request prefix cacheable and it is documented in
`AGENT_INSTRUCTIONS_AND_PROMPT_CACHING.md`. Persona text and memory are user
data, so they cannot go in the product prompt.

They also cannot rely on native `AGENTS.md` discovery, because discovery is
driven by the session working directory, and the working directory belongs to
the scope (vault root or project folder), not to the agent.

So the persona rides in the first user message, next to the existing
`<project_context>` block, as two new blocks:

```text
<agent_persona name="Jennifer">
...body of agent.md...
</agent_persona>

<agent_memory name="Jennifer" updated="2026-09-14">
...contents of MEMORY.md...
</agent_memory>
```

This works identically on all three backends, costs nothing in cache terms
because the first user message is already past the cache wall, and keeps the
envelope builder as the single place persona injection happens. The product
prompt gains one short, constant paragraph telling the model that when an
`<agent_persona>` block is present it should adopt that identity and treat
`<agent_memory>` as things it already knows, that the block it was given is the
only memory that is its own, and that both take precedence over the generic
assistant framing but not over safety or tool policy. That paragraph is
constant, so it does not break the cache rule.

If `agent.md` sets a backend or model, a new chat with that agent opens on that
backend and model. Otherwise the session's current selection is used. Switching
backend mid-chat behaves exactly as it does today.

### 5. Memory

Memory is layered the way OpenClaw layers it, mapped onto the vault. Each agent
owns a small curated file that is always in context and a folder of dated
notes that grows during work and is consolidated in the background.

```text
copilot/agents/jennifer/
  agent.md              instructions, user-owned
  MEMORY.md             curated core: durable facts, always in context,
                        rewritten only by consolidation or by the user
  memory/
    2026-09-16.md       daily note: observations written during work
    2026-09-17.md
```

**Curated core.** `MEMORY.md` keeps the four fixed headings and dated bullets.
Every bullet that came out of consolidation ends with a source anchor to the
daily note it was distilled from, `[[memory/2026-09-17]]`, so the user can
trace any fact back to the day it was learned. A frontmatter field
`consolidated-through: YYYY-MM-DD` records the last daily note folded in.
Budget stays 8k characters.

**Daily notes.** `memory/YYYY-MM-DD.md` is the episodic tier. It has one
heading per conversation, `## HH:MM <chat title>`, and dated bullets beneath.
Two writers append to it:

- The agent itself, during a turn, through its harness's own file tools. The
  persona block names today's note path and says: when you learn something
  worth keeping, append a bullet there; never edit `MEMORY.md`, consolidation
  owns it. This is the equivalent of OpenClaw's in-work writes.
- The plugin, through a flush pass. The flush is the existing read-only
  sub-session, given the turns since the chat's `memorizedThroughTurn` marker
  and asked for the bullets worth keeping, and its output is appended under a
  new heading in today's note. It runs at conversation boundaries (new chat,
  tab switch, close, unload), on a debounce after a turn ends while the chat
  stays open (two minutes idle), on "Update memory now", and after each
  fan-out answer. Nothing is written for a chat with no new turns. This is
  the equivalent of OpenClaw's flush-before-compaction, since the plugin does
  not see the harness's compaction.

Daily notes are not capped. They are ordinary vault notes and stay searchable
and readable by the agent on demand.

**Consolidation.** The only writer of `MEMORY.md` besides the user. A
read-only sub-session on the agent's backend receives the current `MEMORY.md`
and every daily note newer than `consolidated-through`, bounded to the most
recent 32k characters of notes, and returns the complete new file. The prompt
asks it to keep what is still true, merge duplicates, retire what later notes
contradicted and say so in the replacing entry, add only durable facts
(who the user is, preferences, standing requests, open threads, decisions),
date every entry, anchor every entry to its source note, keep the headings,
and stay under budget by compressing the oldest entries first.

Consolidation runs when the plugin has been idle for ten minutes with at least
one daily note newer than `consolidated-through`, on plugin load when the last
consolidation is older than a day and new notes exist, and on demand from the
agent's menu ("Consolidate memory now"). One consolidation per agent at a time.

**Safety rails**, unchanged in spirit: an empty result, a result that lost more
than half the old file's length, or a result missing a heading is rejected and
logged. Replacing `MEMORY.md` uses optimistic concurrency: the file's content
hash is captured when the consolidation input is built and re-checked before
the write, and a mismatch (the user edited meanwhile) discards the result and
reschedules. The user's edits are always the new baseline.

**Reading.** When a chat is bound to an agent, `<agent_memory>` carries
`MEMORY.md` plus today's and yesterday's daily notes. Long chats refresh
per turn: before each user message is sent, if any of those files changed
since the last injection, a fresh `<agent_memory>` block is prepended to that
message. The persona block also names the `memory/` folder so the agent can
read older days with its file tools when a question reaches back further.

**Trust surface.** After a flush lands, the chat shows one quiet line under
the turn, "Jennifer added to today's notes", with an open link to the daily
note. After a consolidation lands, the next turn in any open chat with that
agent shows "Jennifer consolidated their memory" with a link to `MEMORY.md`.
Nothing modal, nothing that nags.

**Fan-out.** An answering agent's flush is fed the question and its own answer
and appends to its daily note; consolidation later folds it in. No change to
`memorizedThroughTurn`, which belongs to the chat's own agent.

**Settings and menus.** The Agents row menu offers Open memory (opens `MEMORY.md`), Open today's notes, Consolidate
memory now, and Clear memory. Clear memory resets `MEMORY.md` to the skeleton
and trashes the `memory/` folder after a confirm.

### 6. Fan-out becomes agent fan-out

Today an answerer is a backend id and the `@` typeahead lists installed
backends. **This is replaced, not extended.** After this change an answerer is a
custom agent, the typeahead lists agents, and the brand answerers `@claude`,
`@codex` and `@opencode` are gone from the typeahead and from the answerer type.
There is no transition period where both kinds exist.

The reason is that a brand answerer was never the interesting unit. "What does
Codex think" is a question about infrastructure; "what does Jennifer think" is a
question about a point of view, and the second one is what a fan-out card is
worth reading. Keeping both would also double every surface that renders an
answerer, and leave the typeahead mixing two things the user chooses between for
unrelated reasons.

A user who genuinely wants to consult a raw backend creates an agent for it: an
empty instructions body, memory off, backend pinned. That reproduces today's
behavior exactly and costs one row in the Agents tab. Existing chats that
already contain a brand fan-out composite still render, because the composite is
persisted as message text and the parser keys sections by label.

When an agent answers a fan-out turn:

- It runs in a fresh read-only sub-session on its configured backend, or the
  session's backend if it has none, exactly as a brand answerer did.
- Its first message carries its `<agent_persona>` and `<agent_memory>` blocks
  plus the shared conversation history, so it answers in character with what it
  knows.
- Its answer tab in the fan-out card is labeled with its icon and name.
- The session's own agent (Copilot or whichever persona owns the chat)
  summarizes, as today. If the chat is a DM with Jennifer and the user
  fans out to Vancat, Jennifer writes the summary.

Fan-out answers count as conversations with that agent. After the fan-out turn
completes, a memory pass runs for each agent that answered, fed the question and
that agent's own answer only. This is what makes "everything you tell this
agent, it remembers" hold even when the agent was only consulted.

Mentioning the chat's own persona in a fan-out turn collapses to the single
agent path, the same rule that applies to `@main` today.

Because fan-out has no answerers until the user has created an agent, the
typeahead's agent group is empty for a new user and offers a "Create an agent"
row that opens the Agents tab.

### 7. Settings: the Agents tab

A new tab, **Agents**, after Skills. Desktop-only panel like Skills. Layout
mirrors the Skills tab: a list with search on the left, an editor on the right.

List row: icon, name, description, backend badge if pinned, memory size, and
a `⋯` menu with Edit, Open folder, Open memory, Clear memory, Delete. A pin to a
backend that cannot be self-hosted also carries the cloud-egress marker the
model pickers use, but only while Self-Host Mode is on.

Editor fields:

| Field         | Notes                                                                 |
| ------------- | --------------------------------------------------------------------- |
| Name          | Required. Slug is derived on create and shown read-only after.        |
| Icon          | Single emoji or letter. Shown in picker, tab, typeahead, fan-out tab. |
| Description   | One line. Shown in the picker and typeahead so the user can choose.   |
| Instructions  | Multi-line body of `agent.md`. Also an "Open in editor" link.         |
| Backend/model | Optional. Same picker components the session uses.                    |
| Effort        | Optional. The levels the pinned model advertises; needs a model pin.  |
| Memory        | Toggle. Off means the memory file is neither read nor written.        |

Create writes `agent.md` and an empty `MEMORY.md` skeleton with the fixed
headings. Edits write `agent.md` frontmatter and body. Copilot never writes
`agent.md` except through this editor, so hand edits in Obsidian are safe.

### 8. Persistence

Agent chats gain one frontmatter field, `agentSlug`, omitted for Copilot, plus
`memorizedThroughTurn`, an integer, omitted when zero. Recent Chats shows the
agent icon before the title when the field is set. Loading a chat whose slug no
longer resolves falls back to Copilot and keeps the label for display.

Fan-out composites already persist as the message body. Custom agent answer
sections use the agent's display name as the section label, which the existing
parser already handles because it keys sections by label.

### 9. Entitlement

- Creating agents and DMing one agent: available to every user. This is the
  adoption path and it costs us nothing on the wire.
- Fan-out, now agents-only: stays Plus, using the existing `canUseMultiAgent`
  gate and the same two-layer pattern (reactive hook hides the typeahead group,
  send-boundary re-check blocks with the upgrade prompt). The gate moves with
  the feature; removing brand answerers does not change who can fan out.

This is a product call worth confirming before implementation. The alternative,
gating DMs behind Plus too, is a one-line change at the picker and the send
boundary.

## Open questions

- **Memory update trigger granularity.** v1 updates at conversation end. If
  users expect "I told you five minutes ago" to work within one long chat, add a
  debounced mid-chat pass later. Design leaves room: the pass is idempotent over
  the memorized-through-turn marker.
- **Persona in resumed native sessions.** A chat resumed from the backend's
  native session store (no autosave note) already has the persona in its first
  message, but the memory in that message is stale. Acceptable for v1.
- **Losing brand answerers.** Replacing them means a Plus user who fans out to
  compare models must first create an agent per backend. Worth deciding whether
  create-on-create seeding (one pinned agent per installed backend, generated
  once at upgrade) is warranted, or whether the empty-state row is enough.
- **Agent count.** No cap in v1. If the typeahead gets crowded, group brands
  and agents under separate headings.
- **One agent reading another's memory.** A fan-out sub-session runs with the
  vault as its working directory and the harness's own file tools, so every
  agent's `MEMORY.md` is a readable note. The persona paragraph tells the model
  that the `<agent_memory>` block is the only memory that is its own and that
  other personas' files are not to be opened, which is an instruction rather
  than a boundary. Enforcing it properly means restricting the sub-session's
  reads, which none of the three harnesses expose per-path today.
- **Cloud egress for a pinned agent.** The Agents roster marks an agent pinned
  to a backend that cannot be self-hosted while Self-Host Mode is on, because
  the session's model picker does not speak for that pin. An agent with no pin
  answers on the session's backend, which the model picker already marks, so
  nothing is marked twice. There is no marker at the moment of sending; if that
  turns out to matter, the composer would need to resolve each mentioned
  agent's effective backend, which it deliberately does not know today.

## Where an implementer starts

1. `src/settings/copilotFolder.ts`: add `agents` to `COPILOT_SUBFOLDER` and a
   deriver, following the design note on resolving once per operation.
2. New `src/agents/` module: `AgentFileManager` (create, read, update, delete,
   list, mirroring `ProjectFileManager`), `agentPaths.ts`, constants for the
   `copilot-agent-*` frontmatter keys, and `agentMemory.ts` for the read, the
   update pass, and the safety checks.
3. `src/agentMode/session/promptEnvelope.ts` and the manifest builder: emit
   `<agent_persona>` and `<agent_memory>` beside `<project_context>`.
4. `src/agentMode/backends/shared/agentSystemPrompt.ts`: one constant paragraph
   describing how to treat the two blocks.
5. `AgentSessionManager`: hold the selected agent alongside the active scope,
   thread it into new-session creation, run the memory pass at the existing
   conversation-boundary hooks.
6. `AgentChatPersistenceManager`: the two new frontmatter fields.
7. `src/agentMode/session/fanout/answerers.ts`, `FanoutOrchestrator.ts`, and
   the `AgentPillNode` / `useAtMentionCategories` typeahead: change the answerer
   type from backend id to agent slug, delete the brand answerer path and its
   typeahead group, and label answer tabs by agent. Net deletion, not an
   addition — the brand code should be gone when this step is done.
8. `src/settings/settingsTabs.ts` and `SettingsMainV2.tsx`: register the tab;
   `src/agents/ui/AgentsSettings.tsx` modeled on `SkillsSettings.tsx`.
9. The model picker popover in the chat composer: the Agent section at the top.
10. Stories for the model picker with its Agent section, the settings editor, and the fan-out card with a
    custom agent tab. Unit tests per the testing guide, including the memory
    safety rails as the boundary cases.

## Implementation milestones

Sequential. Each milestone ends with unit tests green, `npm run format && npm
run lint && npm run build` clean, a deploy to the test vault, an end-to-end
check driven through the live Obsidian UI, and one commit on
`claude/custom-agents-design-spec-6bb304`. The next milestone starts only after
the previous one is verified. The spec is mirrored at
`designdocs/CUSTOM_AGENTS.md` in the repo so the code and the plan travel
together.

| #   | Milestone                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Status                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1  | **Agent files and the Agents settings tab.** `agents` subfolder in `COPILOT_SUBFOLDER`; `src/agents/` with `AgentFileManager`, `agentPaths.ts`, frontmatter constants, `MEMORY.md` skeleton; `agent.md` / `MEMORY.md` excluded from retrieval; Agents tab after Skills with list + editor (name, icon, description, instructions, backend/model, memory toggle), row menu (Edit, Open folder, Open memory, Clear memory, Delete with confirm); stories; unit tests. E2E: create, edit, delete an agent from Settings and see the folder change in the vault.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | ."done (e563f0e9, c258c64b; roster and editor stack vertically because the settings panel is ~653px wide)".                                                                                                                                                  |
| M2  | **Talking-to picker and persona delivery.** Picker top-left of Agent Home header (global and project scope) listing Copilot + agents with icon and description; selection applies to the next new chat only; active tab shows icon + name; `AgentSessionManager` holds the selected agent; `promptEnvelope` emits `<agent_persona>` and `<agent_memory>` beside `<project_context>`; one constant paragraph in the agent system prompt; pinned backend/model honored on new chat; `agentSlug` frontmatter; Recent Chats icon; deleted-agent fallback to Copilot with label kept. E2E: DM an agent and confirm it answers in character and remembers its memory file.                                                                                                                                                                                                                                                                                                                                                                  | done (75435c4f; the tab shows the agent icon always and its name until the chat is titled, so a deleted agent's name survives in the tab tooltip rather than as visible text).                                                                               |
| M3  | **Self-maintained memory.** `agentMemory.ts` read + update pass (isolated read-only sub-session, tombstoned) + safety rails (empty, >50% shrink, missing headings rejected and logged); triggers at conversation boundaries (new chat, tab switch, close, unload) plus "Update memory now" in the chat menu; skips empty chats and chats with no new turns; `memorizedThroughTurn` frontmatter; "<Agent> updated their memory" trust line with an open link; Open/Clear memory from Settings and the agent popover. E2E: hold a chat, end it, watch `MEMORY.md` gain dated entries, start a new chat and see the agent recall them.                                                                                                                                                                                                                                                                                                                                                                                                   | done (e113180f, 022f96c8, af8fc0cf; a completed write also re-binds open chats that have not spoken, so the landing chat opened at the boundary carries the new memory rather than the copy it was created with).                                            |
| M4  | **Agent fan-out replaces brand fan-out.** Answerer type becomes an agent slug; brand answerers (`@claude`, `@codex`, `@opencode`) and their typeahead group are deleted; typeahead lists agents with a "Create an agent" row when empty; answer tabs labeled with agent icon + name; the session's own persona summarizes; per-agent memory pass after a fan-out turn (question + own answer only); mentioning the chat's own persona collapses to the single-agent path; Plus gate unchanged; fan-out card story with a custom agent tab; old brand composites still render. E2E: `@A @B compare these drafts` from a Copilot chat and from a DM.                                                                                                                                                                                                                                                                                                                                                                                    | done (7ba837d7, 3b06bc99; each answer slot carries its own name and icon, so a reloaded tab needs no roster and a brand composite still renders, and the summary sub-session carries the chat's persona so a DM really is summarized in its own voice).      |
| M5  | **End-to-end experience review.** A dedicated pass over the whole flow (create agent, DM, memory, fan-out) for alignment, spacing, design-system use, copy, and empty states, with fixes applied and re-verified in the live UI. Ends with the branch pushed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | done (0572cffe, 78a1e605, b0c482e0; the talking-to trigger now shares the session tab's leading column, and the memory trust line takes the place of the transcript's scroll headroom so it lands under the turn that ended rather than above the composer). |
| M6  | **Agent selection moves into the model picker.** Remove the standalone talking-to control from the Agent Home header. The model picker popover gains an Agent section at the top (heading, Copilot by default, each agent with icon, name, description), a divider, then the existing model and effort sections. Picking an agent with pinned backend, model, or effort switches those sections to the pins; an unpinned agent leaves them alone. Agent editor gains an optional Effort field and `copilot-agent-effort` frontmatter. Open memory / Clear memory stay in Settings. Stories and tests updated. E2E: pick Jennifer from the popover, see model and effort follow her pins, send, and confirm the tab label and reply.                                                                                                                                                                                                                                                                                                   | done (d6c26047, 7975ce2e, a8eede56; picking an agent drafts its pins into the popover's own model and effort, so the pins commit through the same path a hand pick does)                                                                                     |
| M7  | **OpenClaw-style layered memory.** Daily notes under `memory/YYYY-MM-DD.md` as the episodic tier, written by the agent during turns (persona instruction, harness file tools) and by a plugin flush pass at boundaries, on a two-minute idle debounce, on demand, and after fan-out answers. `MEMORY.md` becomes the curated core written only by a background consolidation pass (idle ten minutes, plugin load when stale, or on demand) with source anchors, `consolidated-through` frontmatter, the existing rails, and optimistic concurrency. `<agent_memory>` carries `MEMORY.md` plus today's and yesterday's notes and is re-injected on the next turn whenever those files change. Trust lines for flush and consolidation; menu entries for Open today's notes and Consolidate memory now; Clear memory covers the folder. Stories and tests. E2E: talk in one tab, switch tabs, ask in the other tab what was discussed and get it from today's note; trigger consolidation and see anchored entries land in `MEMORY.md`. | pending                                                                                                                                                                                                                                                      |
| M8  | **Agent select row in the model picker.** Replace the inline agent roster in the popover with one select row (current agent's icon and name, chevron) that opens a nested list of Copilot and all agents with icon, name, description, checkmark, and a search field past six entries. Choosing closes the list; model and effort sections stay fixed; pins still apply as in M6. Stories for two, six, and twelve agents; tests for the select, search, and keyboard path. E2E with twelve agents in the vault.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | pending                                                                                                                                                                                                                                                      |
