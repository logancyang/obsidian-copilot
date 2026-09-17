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

A selector sits at the top-left of the Agent Home header, in both the global
scope and inside a project. It reads **Copilot** by default and lists every
agent with its icon and description. Choosing one applies to the _next_ new
chat and to any chat that has not yet sent a message. A chat that already has
messages keeps the agent it started with. The active chat tab shows the agent's
icon and name so the user always knows who is answering.

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
`<agent_memory>` as things it already knows, and that both take precedence over
the generic assistant framing but not over safety or tool policy. That paragraph
is constant, so it does not break the cache rule.

If `agent.md` sets a backend or model, a new chat with that agent opens on that
backend and model. Otherwise the session's current selection is used. Switching
backend mid-chat behaves exactly as it does today.

### 5. Memory

One file, `MEMORY.md`, per agent. Plain markdown with dated bullets under a few
fixed headings so the agent has structure to append to:

```markdown
# Jennifer's memory

## About the user

- (2026-09-10) Writes a weekly newsletter on climate policy; audience is non-expert.

## Preferences and standing requests

- (2026-09-10) Wants edits shown as a diff, not a rewrite.

## Ongoing threads

- (2026-09-14) Draft "Grid storage explainer" is at v3; user unsure about the intro.

## Facts and decisions

- (2026-09-14) User decided to cut the section on hydrogen.
```

**When it updates.** After a conversation ends, not after every message. A
conversation ends when the user starts a new chat, switches to another chat tab,
closes the chat, or the plugin unloads. The persistence manager already knows
these boundaries. A manual **Update memory now** action is also exposed on the
chat menu for users who want it immediately. Memory update never runs on an
empty chat or on a chat with no new turns since the last update.

**How it updates.** A short, isolated pass, built the same way the fan-out
summary pass is: a fresh read-only sub-session on the agent's backend, given the
current `MEMORY.md` and the conversation transcript (same user-facing history
renderer fan-out uses), asked to return the complete new file. The plugin writes
the returned text to `MEMORY.md` through the vault API. The agent never gets a
write tool for this; the plugin owns the write. The sub-session is tombstoned
like fan-out sub-sessions so it never shows in Recent Chats.

The prompt is intentionally simple for v1:

- Keep what is still true. Merge duplicates. Drop what the conversation
  contradicted, and say so in the entry rather than silently deleting.
- Add only things worth knowing next time: who the user is, preferences,
  standing requests, open threads, decisions. Do not store the conversation
  itself.
- Date new entries. Keep the headings. Stay under a size budget (8k characters
  in v1). When over budget, compress older entries first.

**Safety rails.**

- The plugin diffs the returned file against the old one. An empty result, a
  result that lost more than half its length, or a result missing the headings
  is rejected and the old file is kept. A rejection is logged, not shown.
- The chat's frontmatter records the index of the last turn that was
  memorized, so re-opening and continuing a chat only feeds the new turns.
- The user can open, edit, or clear `MEMORY.md` at any time from Settings or
  from the chat's agent popover. The user's edits are the new baseline.
- Memory is a vault note, so it syncs like any note. Two devices editing at
  once resolve however the user's sync resolves note conflicts; we do not add a
  merge layer.

**Trust surface.** After a memory update lands, the chat shows one quiet line
where the turn ended, "Jennifer updated her memory", with an open link. Nothing
modal, nothing that nags.

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
a `⋯` menu with Edit, Open folder, Open memory, Clear memory, Delete.

Editor fields:

| Field         | Notes                                                                 |
| ------------- | --------------------------------------------------------------------- |
| Name          | Required. Slug is derived on create and shown read-only after.        |
| Icon          | Single emoji or letter. Shown in picker, tab, typeahead, fan-out tab. |
| Description   | One line. Shown in the picker and typeahead so the user can choose.   |
| Instructions  | Multi-line body of `agent.md`. Also an "Open in editor" link.         |
| Backend/model | Optional. Same picker components the session uses.                    |
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
9. `AgentProjectHeader` area in `AgentHome.tsx`: the "talking to" picker.
10. Stories for the picker, the settings editor, and the fan-out card with a
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

| #   | Milestone                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Status                                                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | **Agent files and the Agents settings tab.** `agents` subfolder in `COPILOT_SUBFOLDER`; `src/agents/` with `AgentFileManager`, `agentPaths.ts`, frontmatter constants, `MEMORY.md` skeleton; `agent.md` / `MEMORY.md` excluded from retrieval; Agents tab after Skills with list + editor (name, icon, description, instructions, backend/model, memory toggle), row menu (Edit, Open folder, Open memory, Clear memory, Delete with confirm); stories; unit tests. E2E: create, edit, delete an agent from Settings and see the folder change in the vault.                                                                                                         | ."done (e563f0e9, c258c64b; roster and editor stack vertically because the settings panel is ~653px wide)".                                                                                                       |
| M2  | **Talking-to picker and persona delivery.** Picker top-left of Agent Home header (global and project scope) listing Copilot + agents with icon and description; selection applies to the next new chat only; active tab shows icon + name; `AgentSessionManager` holds the selected agent; `promptEnvelope` emits `<agent_persona>` and `<agent_memory>` beside `<project_context>`; one constant paragraph in the agent system prompt; pinned backend/model honored on new chat; `agentSlug` frontmatter; Recent Chats icon; deleted-agent fallback to Copilot with label kept. E2E: DM an agent and confirm it answers in character and remembers its memory file. | done (75435c4f; the tab shows the agent icon always and its name until the chat is titled, so a deleted agent's name survives in the tab tooltip rather than as visible text).                                    |
| M3  | **Self-maintained memory.** `agentMemory.ts` read + update pass (isolated read-only sub-session, tombstoned) + safety rails (empty, >50% shrink, missing headings rejected and logged); triggers at conversation boundaries (new chat, tab switch, close, unload) plus "Update memory now" in the chat menu; skips empty chats and chats with no new turns; `memorizedThroughTurn` frontmatter; "<Agent> updated their memory" trust line with an open link; Open/Clear memory from Settings and the agent popover. E2E: hold a chat, end it, watch `MEMORY.md` gain dated entries, start a new chat and see the agent recall them.                                  | done (e113180f, 022f96c8, af8fc0cf; a completed write also re-binds open chats that have not spoken, so the landing chat opened at the boundary carries the new memory rather than the copy it was created with). |
| M4  | **Agent fan-out replaces brand fan-out.** Answerer type becomes an agent slug; brand answerers (`@claude`, `@codex`, `@opencode`) and their typeahead group are deleted; typeahead lists agents with a "Create an agent" row when empty; answer tabs labeled with agent icon + name; the session's own persona summarizes; per-agent memory pass after a fan-out turn (question + own answer only); mentioning the chat's own persona collapses to the single-agent path; Plus gate unchanged; fan-out card story with a custom agent tab; old brand composites still render. E2E: `@A @B compare these drafts` from a Copilot chat and from a DM.                   | pending                                                                                                                                                                                                           |
| M5  | **End-to-end experience review.** A dedicated pass over the whole flow (create agent, DM, memory, fan-out) for alignment, spacing, design-system use, copy, and empty states, with fixes applied and re-verified in the live UI. Ends with the branch pushed.                                                                                                                                                                                                                                                                                                                                                                                                        | pending                                                                                                                                                                                                           |
