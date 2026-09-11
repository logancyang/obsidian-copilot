# Copilot voice chat demo: product and technical design

## Purpose and status

A user can open an existing Copilot Agent Mode conversation, turn on voice above the composer, talk and type while the selected agent works, then turn voice off and continue typing in the same conversation. GPT-Live handles the spoken conversation. Claude, Codex, or OpenCode continues to do the actual vault work through Copilot's existing local agent integration.

This is an implementation-ready design for a desktop end-to-end demo, researched on September 10, 2026 against checkout `20837e19`. It records the requested experience and resolves implementation choices needed to build it. The implementation now includes shared task ownership, mixed conversation storage, the Railway service and WebRTC transport, and the desktop composer controls. Native synthesized speech has completed delegated work through Codex and OpenCode. Claude delegation reached the real backend and surfaced its account-quota error. The full backend and UI verification matrix remains pending.

The main recommendation is a small Node service on Railway, direct WebRTC audio between Copilot and OpenAI, and a server-side control connection to GPT-Live. We host the voice service, credentials, and coordination; OpenAI hosts the `gpt-live-1` model. Local coding agents and vault access stay on the user's computer.

## Progress

- [x] Inspect the current Agent Mode submission, cancellation, rendering, session, and persistence paths.
- [x] Verify GPT-Live's client delegation, transcript, transport, session, and cost contracts against official documentation.
- [x] Compare Railway and Cloudflare and specify an executable demo design.
- [x] Prove WebRTC and sideband delegation in the actual Obsidian desktop runtime. The voice handoff verification recorded in `TODO.md` completed one native Codex task.
- [x] Implement shared task submission and mixed conversation storage.
- [x] Implement the Railway voice service and Copilot transport.
- [x] Implement waveform, task cards, mixed transcript, and mode transitions. Native Codex verification covers synthesized speech, typed requests, queued work after End voice, save/reload, disconnect/restart, microphone denial, and popout teardown.
- [x] Complete native spoken delegation with Codex and OpenCode; record measured costs and latency.
- [x] Verify Claude spoken delegation and visible/spoken failure handling against its real account-quota error.
- [x] Verify spoken-to-typed context continuity and Stop with queued work on OpenCode Flash; capture and visually review a local captioned demo.
- [x] Verify voice re-entry without replay, barge-in without backend cancellation, and the ten-minute call cap with microphone teardown in native Obsidian.
- [x] Verify spoken composer-note context and the corrected task-card status through an actual OpenCode Safe-mode edit permission; spoken acknowledgment does not approve the operation.
- [x] Save and restore the OpenCode edited-note conversation in a fresh native session; verify both completed cards and their linked answer survive with voice off. Complete final gallery checks in both themes.
- [ ] Complete the full native acceptance sequence for every backend; successful Claude execution is blocked by account quota.

This section tracks implementation of the feature. The workspace `TODO.md` tracks the current implementation and verification task.

## Product design

### The experience

The composer gains a voice button in Agent Mode. Clicking it starts the microphone permission and connection flow. A compact voice bar appears immediately above the existing composer, containing the assistant's waveform, microphone mute, elapsed call time, connection status, and **End voice**. The input remains usable for text, note references, images, and existing context controls. Voice mode does not replace the composer or open a second chat panel.

The assistant waveform follows actual received audio amplitude. A separate microphone indicator shows capture activity. GPT-Live can listen while speaking, so microphone state, playback activity, connection state, and local task state are independent. A flat waveform must not imply that the agent has finished working. Provide text labels and reduced-motion behavior; do not rely on animation or color alone.

The conversation reads approximately like this:

    User: Find the notes where I discussed the launch risks.
    Assistant: I'll look through your notes.
    [OpenCode · Working · View details]
    User: Focus on the customer feedback.
    [Follow-up queued · Runs after the current task]
    Assistant: I found three relevant notes. The main concern was onboarding.

    [assistant waveform]  Mic on  01:24  End voice
    [Type a message, add notes or images…]                [Send]

Speech transcripts appear as user messages, and GPT-Live output transcripts appear as assistant messages. Captions update incrementally; speech does not need to wait for a backend response. Backend prose and its tool trail appear inside the linked task card. Exact answers, links, and code remain available there even when the spoken response is shorter. The frontend may paraphrase the backend result; verbatim narration is not a demo requirement.

Approvals, questions, plan review, and errors remain visible and actionable. GPT-Live may explain that Copilot needs a click, but a spoken “yes” does not approve a tool operation in this demo. Existing local permission enforcement remains authoritative.

Existing submission locks during required plan or permission decisions still apply. The voice frontend can continue talking, but neither typed nor spoken submissions bypass the required decision. Accepted queued requests remain queued until the session is allowed to run them.

### Mode and control behavior

| Action                                                  | Observable behavior                                                                                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start voice while the backend is idle                   | Keep the same chat and backend session; connect voice using recent conversation context.                                                                       |
| Start voice during a text task                          | The existing task keeps its ordinary text presentation. Voice learns that it is already running and does not submit it again.                                  |
| Type while voice is active                              | Submit through the shared local queue, mirror the accepted request into voice context, and show the backend response in a task card.                           |
| Speak while a task is running                           | Conversation continues; delegated follow-ups wait in the shared queue. The UI explicitly says they have not changed the running task.                          |
| Interrupt the assistant's speech                        | Stop or redirect speech through GPT-Live's conversational behavior. Local agent work continues.                                                                |
| Click the existing Stop control                         | Clear queued work first, request cancellation of the active backend turn, and report cancellation only after its outcome is known. Voice may remain connected. |
| Mute microphone                                         | Stop sending microphone content. Keep playback and local work available. Muting is not the end of billing.                                                     |
| End voice                                               | Stop capture and playback, close the Live session, preserve the conversation and accepted local work. The next typed request uses normal text mode.            |
| End voice during a delegated task                       | Its existing card continues updating and exposes the final answer. Do not create a second top-level answer or reconnect voice to speak it.                     |
| Start voice again                                       | Create a fresh Live session with bounded recent context and current task facts. Resume the existing backend session.                                           |
| Change chat, project, or backend; close the owning view | End voice before changing ownership. Keep local tasks under their existing lifecycle rules.                                                                    |

The demo supports one active voice conversation per plugin instance and one selected backend per conversation. Multi-agent fan-out, mobile voice, automatic call reconnection, and voice-only approval are outside this demo. Existing text-only capabilities continue to work when voice is off. If fan-out is selected, the voice control explains that a single agent must be selected first.

### What steering means here

Task steering means cancelling the active agent turn and dispatching replacement work in the same conversation. It reuses the existing `BackendProcess.cancel()` and `prompt()` contract. Interrupting assistant speech alone does not submit or cancel local work.

The original demo queued corrections until the active task finished. OpenCode now opts into task steering through its backend descriptor: accepted typed and delegated requests cancel the active turn, then start replacement work in the same session. Cancellation acknowledgment and the existing prompt-drain barrier protect the replacement from late cancellation and output. Consecutive typed requests during handoff still merge; a newer request involving voice supersedes pending replacements and reports them cancelled. Other backends retain queueing until they opt in. Context and foreground dispatch holds still apply. Steering does not undo completed work or approve pending permissions, and an interrupted waveform alone never indicates that local work stopped.

Backend capability is enabled separately after cancellation and replacement tests for that adapter. OpenCode is enabled here; Claude and Codex remain queued until their dedicated steering changes. This does not require native in-turn instruction injection or concurrent prompts. Native verification is recorded separately from unit tests.

## Context and orientation

Agent Mode already has a backend-neutral session layer. `src/agentMode/session/AgentSession.ts` runs one backend turn at a time, builds note and project context, handles permission state, and feeds `AgentMessageStore`. Codex and OpenCode reach this contract through ACP, the agent subprocess protocol. Claude's SDK adapter implements the same domain contract directly. Voice must sit above that boundary, not introduce a new Claude-specific or Codex-specific pipeline.

The relevant existing files and changes are:

| File                                                                      | Current responsibility and required change                                                                                                                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/agentMode/session/types.ts`                                          | Add optional conversation provenance and task presentation metadata without requiring it on old messages. Keep `BackendProcess` unchanged for the demo.                                                |
| `src/agentMode/session/AgentSession.ts`                                   | Reuse prompt construction and cancellation. Add a submission path that links existing public message IDs to backend work without creating duplicate public user rows. Expose task settlement by ID.    |
| `src/agentMode/session/AgentMessageStore.ts`                              | Remain the single in-memory message owner. Add task records, transcript updates, and separate render/persistence projections.                                                                          |
| `src/agentMode/session/AgentChatBackend.ts` and `AgentChatUIState.ts`     | Expose shared submissions and typed task outcomes through the existing UI boundary. Do not treat a resolved `sendMessage()` promise as proof of success: the current UI wrapper catches turn failures. |
| `src/agentMode/ui/AgentChatInput.tsx`                                     | Keep draft/context capture and controls. Move queue execution into the shared submission owner so voice cannot race a second queue. Preserve clear-queue-before-cancel behavior.                       |
| `src/agentMode/ui/AgentHome.tsx`                                          | Mount the voice bar alongside the composer and bind it to the selected conversation. Avoid creating a new session when the landing/chat layout remounts.                                               |
| `src/agentMode/ui/AgentChatMessages.tsx`                                  | Render public conversation rows and task cards. Replace “last assistant message is streaming” assumptions with explicit active task/message identities.                                                |
| `src/agentMode/ui/hooks/useAgentChatRuntimeState.ts`                      | Subscribe to a coherent session snapshot including voice/task state; avoid combining inconsistent snapshots from independent stores.                                                                   |
| `src/agentMode/session/AgentChatPersistenceManager.ts`                    | Add a versioned mixed-conversation format. Current Markdown reload reconstructs sender/text and loses structured parts.                                                                                |
| `src/agentMode/session/AgentSessionManager.ts` and `AgentSessionIndex.ts` | Save the full persistable projection, retain conversation identity alongside native session identity, and overlay the saved mixed transcript when resuming native history.                             |

Follow [Agent Mode layer rules](../src/agentMode/AGENTS.md), [runtime guidance](agents/PLUGIN_DEV_GUIDE.md), [style guidance](agents/STYLE_GUIDE.md), and [testing guidance](agents/TESTING_GUIDE.md). The UI stays backend-neutral. Audio APIs must come from the owning Obsidian window, including popouts. Use the provided `app` dependency, not a global. Non-streaming plugin HTTP uses the existing Obsidian-safe request path; WebSocket/WebRTC are justified streaming transports.

## Architecture and ownership

### Selected topology

    Copilot desktop                           Our Railway service
    ┌──────────────────────────┐              ┌────────────────────────┐
    │ Composer + transcript    │  HTTPS / WS   │ Authentication         │
    │ Voice bar + WebRTC       │◄─────────────►│ Live session ownership │
    │ Shared task coordinator  │  task facts  │ Delegation notifications│
    │ AgentMessageStore        │              │ Usage + limits         │
    │ Claude / Codex / OpenCode │              └───────────┬────────────┘
    │ Local vault + permissions│                          │ sideband WS
    └────────────┬─────────────┘                          │
                 │ WebRTC audio + event channel          │
                 └────────────────────► OpenAI GPT-Live ◄─┘

“Sideband” means a second connection to an existing Live session that lets our server observe events and send control/context updates while WebRTC carries the primary media connection. This is an official server-control pattern. The sideband also receives reflected audio events: the server must discard their payloads immediately rather than buffer or log them. This topology minimizes our application protocol and avoids implementing audio playback/resampling on our server; it does not mean that the server receives no audio. [OpenAI server controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live)

Copilot owns durable conversation content, task execution, attachment resolution, permissions, and rendering. Railway owns authentication, the OpenAI key, session creation/closure, delegation notifications, and bounded usage. OpenAI owns speech generation and live conversational behavior. The server never receives local agent credentials, executable tool handles, or direct vault access.

The client needs native WebRTC, media capture, Web Audio for the waveform, and a small authenticated WebSocket client. It does not need a new ChatGPT Live SDK. The server uses the standard OpenAI Node SDK with Live support, plus `ws` and a small HTTP server. Pin the actual SDK version validated by the transport spike; do not assume this checkout's `openai` dependency already contains the required surface. The server has its own package and lockfile, so this does not force a plugin dependency upgrade.

### Why not send all audio through our server?

A full relay is possible: client audio frames go to our service, which opens a primary Live WebSocket and forwards audio and events in both directions. It adds a media hop and responsibility for framing, resampling, playback buffering, backpressure, and interruption handling. The documented WebSocket media format is PCM16 little-endian at 24 kHz. That is a viable fallback if direct WebRTC fails in Obsidian or a future requirement forbids client connections to OpenAI. It is not the initial implementation. [OpenAI WebSocket connection guide](https://developers.openai.com/api/docs/guides/voice-websockets?api=live)

## Conversation, task, and rendering model

### One conversation with two kinds of assistant output

Stop modelling a conversation as mandatory user/assistant pairs. A public conversation contains user entries, assistant speech/text entries, and linked task cards. One request can produce an acknowledgment, a tool-running card, a clarification, and a final spoken response. Several user entries may precede one backend turn.

Extend existing message records with optional `origin` (`typed`, `voice-user`, `voice-assistant`, `backend`), `voiceSessionId`, `taskId`, and `presentation` (`conversation`, `task-detail`). Missing metadata means existing text behavior. Keep `sender` compatible with current rendering and persistence. A separate task record inside `AgentMessageStore` holds `taskId`, source message IDs, backend placeholder ID, delegation IDs, state, and a presentation captured at submission: `text` or `voice-card`.

Task state is `queued`, `running`, `awaiting-user`, `completed`, `cancelled`, `failed`, or `interrupted` after reload with no confirmed terminal outcome. Voice state is `off`, `connecting`, `active`, `closing`, or `error`, plus independent mute/playback flags. Neither state machine stands in for the other.

`AgentMessageStore` remains authoritative. `getConversationRows()` projects public messages and one card for each voice task. `getTaskDetails(taskId)` supplies existing backend prose and activity leaves to the card. `getPersistableConversation()` includes the saved public transcript and task answer/status. Do not implement this by merely setting `isVisible = false`: the existing `getDisplayMessages()` and autosave paths filter by visibility and would lose hidden backend answers.

Backend events continue to land in their original placeholder and structured parts. The renderer determines where those parts appear. Capture presentation before work starts, so toggling voice never moves historical answers or redirects late chunks into the newest speech bubble. A task that began in text mode finishes in its original normal answer bubble; the voice frontend receives quiet facts about it without unsolicited duplicate narration.

### Transcript assembly

Use the primary WebRTC event channel as Copilot's transcript ingestion path. The server is the sole handler that converts Live delegation notifications into application requests. Copilot deduplicates transcript fragments by `(voiceSessionId, event_id)` and preserves `delta` verbatim with its timestamps and role. Do not trim every fragment or assume a delta is a sentence.

GPT-Live transcript events have time ranges but do not supply a conventional complete user-message boundary. Copilot groups adjacent same-speaker fragments for readable captions, retaining their fragment IDs and ranges so late fragments can amend the group. Grouping is presentation logic, not permission to execute a task. Output captions represent model output and are not proof that every word was played; after connection loss or abrupt closure, mark an affected entry as interrupted rather than claiming it was fully heard. [OpenAI conversation guide](https://developers.openai.com/api/docs/guides/live-conversations)

Persist the assembled text, stable row identity, source ranges, and task links; raw audio is never saved. Keep raw event deduplication data bounded to the live session. A reconnect creates a new Live identity and never replays old delegation events.

### Local task submission and queue

Introduce `AgentTaskCoordinator` in `session/`, owned by the existing session lifecycle. It accepts typed submissions and voice delegation context, assigns stable task IDs, captures presentation, and serializes all calls to `AgentSession`. Move the current queue scheduling into this owner instead of implementing a parallel voice queue. The composer remains responsible for collecting the draft and attachments before submitting an immutable payload.

Preserve existing typed queue ordering and combination semantics. Voice requests have explicit source boundaries and cannot be merged across different delegation IDs without recording all of those IDs against the resulting task. For the demo, keep distinct voice requests as distinct queued tasks. There is still only one active backend turn. Preserve the current foreground-only queue dispatch rule; changing chats ends voice and must not secretly flush queued work in an inactive chat.

The task coordinator inserts or references public user rows once. `AgentSession` creates the backend assistant placeholder with its task ID, but does not add another public copy of already displayed voice text or typed text. Prompt context stays in the backend request rather than appearing as a synthetic user bubble.

Stop first removes queued submissions, then requests cancellation. Results carry `taskId` and a generation number so stale callbacks cannot complete a replacement task. Speech appends about cancelled, failed, or obsolete work must reflect that state. A fulfilled UI promise, a tool-start event, and a voice acknowledgment are all insufficient evidence of successful completion.

## Delegation design

### Choose client delegation for the demo

Create Live sessions with `delegation: { type: "client" }`. The selected local agent is the reasoning backend. We do not add a mandatory Luna router between GPT-Live and Claude/Codex/OpenCode.

GPT-Live's managed Responses mode, as used by a Live-plus-Luna integration, gives a reasoning model conversation context and lets it produce structured function calls. This helps interpret requests; it does not make every utterance a complete command or provide exactly-once external execution. Client mode leaves construction of the backend request to our application. Its `session.delegation.created` notification contains an opaque delegation ID and an audio offset, not task text. [OpenAI delegation guide](https://developers.openai.com/api/docs/guides/live-delegation)

The selected agent already understands conversation and can ask for missing details. Forward role-labelled recent context to it rather than trying to extract intent with a regular expression. A new voice context envelope explains transcript uncertainty and identifies the current request window, accepted tasks, and prior answers as reference data. Existing backend system prompts remain unchanged. The voice frontend's new instructions describe delegation, short spoken results, queue limitations, and the requirement to rely on verified task status.

If the managed Luna alternative becomes necessary, its only local execution tool should request a task through the same Copilot coordinator. The server must collect completed function-call items, return their corresponding function outputs, and explicitly continue the managed response. That adds another inference step, model cost, and response lifecycle to maintain. Delegation mode is fixed when a Live session is created, so testing this alternative requires a new session rather than changing an active call. It does not remove local permissions, deduplication, or busy-task handling.

### From speech to a local task

When the server sees `session.delegation.created`, it sends `delegation.requested` containing the original ID and offset to Copilot. The client records it as pending before acknowledging receipt. It waits for relevant user transcript fragments if the notification arrives first. It then constructs a context snapshot containing new speech, nearby assistant speech, relevant earlier exchanges, current selection/context references, and accepted/running task facts.

For the initial spike, use a short configurable settling delay after new user transcript arrival, initially 500 ms, with a two-second maximum wait before surfacing that the request is still incomplete. Assistant captions do not restart this settling delay. A timeout reports that no usable transcript was ready; it does not mark speech as already claimed. These are starting parameters to measure, not API guarantees. A delegation signal and usable user text are both required before dispatch; silence or a timer alone cannot authorize work. The delegation offset marks when the model delegates, which can be later than the end of user speech, so user transcript timestamps do not need to reach it. If there is no usable user text, keep the request pending and have the frontend ask the user to finish or repeat it. If this conservative rule repeatedly blocks complete requests in the native spike, revise it with captured timing evidence before building the full UI.

The backend receives a labelled conversation request, not a guessed standalone imperative. It must interpret the latest request, use ordinary local tools when appropriate, and ask for clarification when essential details are missing. Transcript errors can still misstate user intent; existing operation permissions remain necessary. The demo does not promise perfect utterance segmentation or natural-language deduplication.

Claim source speech fragment IDs when accepting a task. Repeated delegation IDs return the recorded task status. A new delegation that covers only already claimed speech does not start the same task again. Later user speech can create a new task; if work is busy it queues. The queued request retains its captured context and gains current verified task outcomes when eventually dispatched. Do not quietly reinterpret a queued correction as already applied steering.

### Typed input during voice

Typed Send goes directly through `AgentTaskCoordinator`. It has an explicit submission ID and requires no Live delegation signal. After acceptance, Copilot sends the server a compact factual update containing that ID, task status, and the typed request; the server mirrors it into Live context. This keeps exact strings and attachments on the established local prompt path.

A subsequent Live delegation with no new unclaimed speech does not submit that typed task again. If speech arrives around a typed request, only the new speech can initiate another delegation; include the accepted typed task in its context. IDs prevent transport retries from repeating the same task. They do not prove that two differently worded requests are semantically identical. The demo explicitly tests simultaneous typing and speaking.

### Returning progress and results

Copilot sends sparse structured task facts to the server: queued, started, waiting for approval, completed, failed, cancelled, and a bounded answer excerpt. Do not stream raw tool output or private reasoning to GPT-Live. The server maps background facts to `session.thinking.append` and a result worth saying to `session.commentary.append`. These updates are plain strings, capped by the API at 500 tokens each, with the original client delegation ID or `null` for general/typed-task context. An append acknowledgment confirms context injection timing, not speech playback or local action success. [OpenAI delegation update contract](https://developers.openai.com/api/docs/guides/live-delegation#send-the-right-kind-of-update)

Use deterministic bounded formatting for the demo, with task status, source links/titles where useful, and an explicitly labelled excerpt if the answer is too long. Do not add another model solely to summarize results. Full Markdown stays in the task card. A truncated excerpt must not be described as the full answer; GPT-Live can direct the user to details.

Only enqueue narration while the originating voice session remains active and the task presentation is `voice-card`. After End voice, keep accepting backend results locally but stop outbound narration. A later voice session gets completed-task facts as context, not a replay of previous result announcements.

## Text and voice context continuity

There are two model contexts but one user conversation. A local backend knows prompts it received and its own results. GPT-Live knows speech and mirrored application facts. Neither automatically knows everything the other said.

On voice entry, serialize bounded recent public exchanges, current task facts, and concise current UI context into `session.input`. The documented startup limit is 128 messages and 8,192 tokens; reserve headroom for instructions and formatting. Prefer recent verbatim exchanges and explicit task facts over an extra summarization model. Mark omitted older context. The startup roles are `developer`, `user`, and `assistant`. [OpenAI history seeding](https://developers.openai.com/api/docs/guides/live-conversations#seed-a-session-with-prior-conversation)

Track which public entries each backend session has received using a context cursor plus explicit IDs for entries covered by accepted tasks. Before its next prompt, prepend only relevant unconsumed voice exchanges in a role-labelled context block, followed by the new request. Mark earlier assistant speech and task answers as historical reference, not fresh instructions. `AgentSession` already buffers prior fan-out context for a similar missing-context case; reuse its prompt-building pattern without conflating fan-out and voice state.

Advance the delivery cursor after the backend accepts the request, not when the user clicks Send. If acceptance is uncertain because the process disconnects, retain an uncertain-delivery record and do not automatically resend. Context delivery and task execution need separate bookkeeping: restoring conversation context must never rerun historical tools.

Ending voice does not replace or reset the backend session. “Use the second option we discussed” typed afterwards should resolve against the recent voice exchange included with that next request. Re-entering voice creates a fresh Live session with the same conversation ID and current facts. Native backend resume failure remains an explicit existing resume/new-session path, not a silent claim of full continuity.

## Persistence and reload

Use the existing conversation Markdown file and autosave preference. Add `agentChatSchema: 2` and a stable `conversationId` only for sessions that use voice. Retain backend ID, native session ID, and project scope. Existing schema-less chats keep their current parser and do not require a bulk migration.

The visible Markdown contains public user/assistant text and readable task summaries with full final answer text. Append one encoded metadata comment containing a versioned JSON snapshot: saved message bodies and stable IDs, origins, source ranges, task answers/links/presentation/status, and the backend context-delivery cursor. Encode UTF-8 JSON as base64 so user content cannot terminate the comment. Include a SHA-256 digest of the exact visible body. This duplicates saved text within one file to keep both ordinary Markdown reading and reliable structured reload; it does not add a second transcript database.

On load, trust structured metadata only when schema validation and the body digest succeed. Reconstruct content from the validated snapshot. If a user manually edited the Markdown or metadata is invalid, open the readable transcript with an explicit “Structured voice history unavailable” notice; do not replay tasks or silently overwrite the edited source during autosave. Explicit Save can create a fresh snapshot after the user resumes. Unknown future schema versions open read-only. Test literal message markers and comment-like text inside user content. A digest detects mismatched projections; it is not an authentication mechanism and grants no authority to saved content.

Persist the answer and task state needed for continuation, not raw audio, credentials, permission resolvers, or hidden reasoning. Existing detailed tool trails can remain live-only for this demo; after reload, the card says when activity details are unavailable. Saved pending approvals are historical status, never executable buttons. Unsettled tasks reload as interrupted until the native agent provides a verified current status.

Update `AgentSessionManager` to save `getPersistableConversation()`, not the display-filtered messages. Add optional mixed-transcript file identity to the session index so native history resume overlays public voice messages rather than replacing them with backend-only history. Respect project isolation. Serialize writes through the existing save queue, save one complete snapshot per write, and preserve the prior valid file on a failed save using the repository's vault I/O conventions. Autosave disabled means no new background transcript persistence; explicit Save remains available. End voice must work even if saving fails and show the unsaved state.

## Interfaces and dependencies

### Copilot domain contracts

The proposed types belong in `src/agentMode/session/voiceTypes.ts`. They describe application state, not OpenAI wire events:

    interface AgentTaskSubmission {
      submissionId: string;
      conversationId: string;
      sourceMessageIds: readonly string[];
      source: "typed" | "voice";
      presentation: "text" | "voice-card";
      requestText: string;
      context?: MessageContext;
      promptContent?: readonly PromptContent[];
      mentionedAgents?: readonly BackendId[];
      voiceSessionId?: string;
      delegationId?: string;
    }

    interface AgentTaskResult {
      taskId: string;
      state: "completed" | "cancelled" | "failed" | "interrupted";
      assistantMessageId: string;
      answerText: string;
      errorCode?: string;
    }

`AgentTaskCoordinator.submit()` synchronously records acceptance or rejection after the caller has resolved attachments; task completion is a separate subscription/outcome. Retain the existing `PromptContent` image/resource blocks and agent selection on text submissions; voice-enabled submissions require one selected agent. A `completed` outcome means the agent response is ready, not that every requested external operation succeeded. Spoken operation claims must come from the returned answer and verified task facts. `cancelActiveAndClearQueue()` preserves current Stop ordering. `VoiceSessionController.start()`, `setMuted()`, and `close()` manage media/control lifetime without owning backend lifetime. All public callables get behavioral coverage. Keep snapshots referentially stable and reuse frozen empty values.

Place the neutral coordinator in `session/`. Put browser/network-specific code in a new `src/agentMode/voice/` layer and inject it into the session/controller boundary from plugin wiring. Update `eslint.config.mjs`, `src/agentMode/AGENTS.md`, and `src/agentMode/index.ts` accordingly. The transport layer may depend on session types; session code must not import transport, ACP, or Claude SDK implementations.

Add a default-off demo setting under `agentMode.voice` in `src/settings/model.ts`, containing `enabled`, `serverUrl`, and a credential reference. Follow the existing settings normalization/migration and SecretStorage patterns, including `src/services/keychainService.ts`. Settings lacking this object behave exactly as before. Surface connection setup through existing settings UI, with secrets masked. Gate the voice button on desktop Agent Mode, configured service access, and a single selected backend; do not load server-only dependencies into the plugin or mobile bundle.

### Application protocol

The dependency-free protocol definition lives at `shared/voiceProtocol.ts` in the separate `zeroliu/copilot-voice` repository. The corresponding copy at `src/agentMode/voice/voiceProtocol.ts` ships in the plugin. Change the server copy first and copy it into the plugin; both sides use its runtime validation. The current copies differ only in the plugin's provenance comment and formatting. No separate published protocol package or generated client is required.

Every application event includes `protocolVersion: 1`, `eventId`, `conversationId`, and our `voiceSessionId`. Server events carry a monotonically increasing sequence number within that session. Acks refer to event IDs. Live's session ID and delegation ID are separate opaque identifiers; never reconstruct them from application IDs.

| Direction        | Event or endpoint                                                       | Contract                                                                                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client → server  | `POST /v1/voice/sessions`                                               | Authenticated creation with SDP offer, bounded startup context, backend display name, conversation ID, and unique creation request ID. Returns SDP answer, application session ID, and one-use WebSocket ticket. |
| Client → server  | `WS /v1/voice/sessions/:id/control`                                     | Authenticate in the first frame using the short-lived ticket; do not put credentials in URLs. No application events before authentication.                                                                       |
| Server → client  | `delegation.requested`                                                  | Original Live delegation ID and offset. Does not invent task text.                                                                                                                                               |
| Client → server  | `delegation.accepted` / `delegation.deferred`                           | Records mapped task ID, or missing transcript/claimed-context reason. Repeated IDs return the same mapping.                                                                                                      |
| Client → server  | `task.updated`                                                          | Task ID, revision, factual state, bounded result/context. Ignore an older revision.                                                                                                                              |
| Client → server  | `context.updated`                                                       | Accepted typed submission and current UI/task facts, deduplicated by event ID.                                                                                                                                   |
| Client → server  | `input.mute` / `input.unmute`                                           | Pair local capture state with Live mute/unmute commands; acknowledge the upstream result separately from the local toggle.                                                                                       |
| Either direction | `ack`, `ping`, `pong`, `error`                                          | Receipt, liveness, and typed recoverable/fatal failures. Receipt is distinct from execution.                                                                                                                     |
| Client → server  | `session.close`, authenticated `DELETE /v1/voice/sessions/:id` fallback | Idempotently end voice resources, never cancel local work.                                                                                                                                                       |
| Server → client  | `session.closed` / `usage.updated`                                      | Close reason and cumulative usage, including whether final accounting is confirmed.                                                                                                                              |

Bound message payloads to 64 KiB, creation input to 256 KiB plus the token/message limit, and server retention to the current call. Limit outbound queues; close voice with a clear error rather than growing memory without bound. Acknowledged task facts may be resent with the same ID during a connected session. Never automatically replay an unacknowledged task execution command after a crash.

### Session startup and shutdown

From the voice-button gesture, create media resources in the owning window, with capture tracks initially disabled. Create `RTCPeerConnection` and the `oai-events` data channel, install listeners, create the SDP offer, and wait for ICE gathering. Send the offer through our authenticated creation endpoint. Our service creates an OpenAI WebRTC Live session with model, client delegation, instructions, startup input, and `transport: { type: "webrtc", sdp }`. It attaches its sideband before releasing the answer. The client authenticates the control channel, applies the SDP answer, waits for readiness, then enables the microphone. WebRTC session creation does not require a separate `session.start` event. [OpenAI WebRTC guide](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live)

The service creates sessions with `POST https://api.openai.com/v1/live/sessions` and uses `wss://api.openai.com/v1/live/sessions/{session_id}/attach` with its OpenAI project credential. Set `store: false`; the demo restores local text history rather than using provider recordings/forks. Retain delegation notifications received before the client control channel is ready. Sideband attachment does not replay historical events, so do not begin usable audio before both control and media paths are ready. Track readiness explicitly and expire unclaimed creations after 30 seconds. A repeated creation request ID returns the same pending/result state rather than opening another billable call.

Mute immediately disables the local microphone track and sends `session.input_audio.mute` through the server. Unmute waits for the matching accepted command before enabling capture. Handle rejected commands explicitly; local capture stays off on failure. Preserve negotiated silent input while needed for session progress, independently of whether microphone content is enabled. The frontend's button state must distinguish locally muted from a pending server command.

For End voice, install the terminal listener, request `session.close`, stop the local microphone tracks, and silence playback immediately. Keep the peer connection, event channel, and sideband receiver alive while waiting for terminal confirmation for up to five seconds; stopping capture does not require closing those channels. Then dispose the remaining transports and display uncertain closure if needed. Verify both the local track's ended state and the native microphone indicator in acceptance testing. The server closes upstream on explicit close, failed client liveness, or its hard session deadline. Use 15-second heartbeat intervals and a 45-second client timeout. Maximum call duration is ten minutes for the demo, with a warning at nine minutes. These are configurable application limits, not claimed platform limits.

On sideband loss, stop accepting delegations, notify Copilot, and close the primary call. On media or control loss, fall back to text; preserve local work. Do not automatically attach a new call or replay missed speech. Starting voice again is a user action with a new identity and fresh context.

## Hosting decision and operating cost

### Railway for the demo

Use one Railway service and one replica, with a pinned Node 24 runtime, a Dockerfile, the normal Node OpenAI SDK, and `ws`. No server database, Redis, or volume is required for ephemeral call state. Disable optional application sleeping for the demo. Deployment or process failure ends affected voice calls; Copilot continues in text mode. This is the simplest runtime match, not an assertion that Railway has better measured uptime than Cloudflare.

Railway documents WebSocket support and exempts WebSocket connections from its HTTP duration/inactivity limits. Verify actual ten-minute sessions and deployment shutdown in the spike. [Railway networking limits](https://docs.railway.com/networking/public-networking/specs-and-limits)

### Comparison

| Consideration    | Railway Node service                                                                     | Cloudflare Worker + one Durable Object per call                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Implementation   | Standard Node SDK and sockets; one in-memory session owner.                              | Adapt to Workers sockets/runtime and route state to a Durable Object, an object that owns a call's connections. |
| Free allowance   | Free plan includes $1/month of resources; trial offers a separate one-time credit.       | Stronger recurring free allowance for requests and Durable Object duration, subject to daily limits.            |
| Paid entry       | Hobby $5/month including $5 resource usage; account/team needs may require another plan. | Workers Paid begins at $5/month with included usage.                                                            |
| Live socket cost | Running process memory/CPU plus network.                                                 | An outgoing Live socket prevents hibernation, so active call duration counts.                                   |
| Failure boundary | Process restart ends calls in that replica.                                              | Object/runtime restart requires connection recovery or explicit call termination.                               |
| Recommendation   | Ship the demo here.                                                                      | Reconsider if recurring free hosting becomes the dominant requirement.                                          |

Railway resource rates currently include $10/GB-month RAM, $20/vCPU-month CPU, and $0.05/GB egress. Hobby's subscription is a usage minimum, not $5 plus all resource use. A service averaging 0.25 GB RAM costs about $2.50/month for RAM alone; CPU and network must be measured before claiming it fits the minimum. Its $1 Free allowance does not guarantee a free always-on service. [Railway plans](https://docs.railway.com/pricing/plans)

Cloudflare's SQLite Durable Objects are available on Free, including 100,000 requests/day and 13,000 GB-seconds/day; paid allowances differ. An outgoing WebSocket cannot use hibernation, so do not apply idle-client socket savings to a Live call. Free-limit exhaustion can fail requests. Cloudflare is likely cheaper at small usage if it fits these limits, but that does not remove integration work. [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [WebSocket lifecycle](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

GPT-Live costs $0.05 per connected minute, billed by duration, including listening, silence, and waiting for backend work. Ten minutes is about $0.50; ten hours is about $30, before local agent/provider charges and hosting. WebRTC creation has a 15-second minimum charge credited toward the session duration. Backend inference is additional. No hosting free tier pays this model bill. [GPT-Live model pricing](https://developers.openai.com/api/docs/models/gpt-live-1), [Live latency and cost](https://developers.openai.com/api/docs/guides/voice-latency-cost?api=live)

Record cumulative usage as a maximum/latest value, not a sum of repeated usage events. Show an estimate when final accounting is unavailable. Use a dedicated OpenAI project with spending controls, a ten-minute call cap, one call per demo credential, and an initial deployment-wide cap of three calls. An in-memory daily counter is only a soft limit because restarts reset it; provider-side budget controls are the durable backstop. Do not advertise a hard application billing cap without durable accounting.

### Authentication and deployment contract

The server is maintained in the separate [zeroliu/copilot-voice repository](https://github.com/zeroliu/copilot-voice), locally checked out at `/Users/zeroliu/Developer/copilot-voice` for this demo. It owns its dependencies, Dockerfile, protocol source and deployment scripts. Its `build`, `test`, `typecheck` and `start` scripts run from that checkout; `start` runs `node dist/src/index.js`. Operator setup, credential provisioning and deployment evidence are in that repository's `docs/DEPLOY.md`. There is no `services/voice-server/` directory in this plugin checkout.

Configure `OPENAI_API_KEY`, hashed allowlisted demo credentials, `PORT`, `MAX_SESSION_SECONDS=600`, `MAX_CONCURRENT_SESSIONS=3`, and log level as Railway environment settings/secrets. Bind the server to `0.0.0.0:$PORT`. `GET /healthz` returns HTTP 200 and `{"status":"ok"}` without exposing keys or creating a Live session. Readiness fails when required configuration is absent. On SIGTERM stop accepting creation, notify clients, and attempt graceful upstream closure within the platform shutdown window.

For this private demo, provision one revocable bearer credential per tester. Store its client value through Copilot's existing SecretStorage/keychain pattern, not syncable settings or source code. Use it only for authenticated HTTPS creation/closure; exchange it for a single-use, short-lived control ticket. Bind every call to its owner and conversation. Reject attempts to address another owner's session. Authenticate WebSockets immediately and disconnect unauthenticated sockets after five seconds. Public access and product subscription billing are later work.

Log identifiers, state transitions, durations, counts, close reasons, and error codes through the appropriate logger. Exclude transcripts, note bodies, raw audio, SDP, tokens, and tool arguments. Server-side thinking context is not a secret channel: anything provided to GPT-Live may influence future speech. Send only context needed for the conversation. Existing local permissions govern operations; a server message can request a local agent turn but cannot bypass them.

## Plan of work and concrete steps

### Milestone 1: prove the transport and delegation boundary

Build the smallest server and a feature-gated Copilot transport harness in the actual plugin. Verify microphone permission, remote playback, transcript events, a sideband delegation arriving before/after transcript text, a result append, and graceful closure. Use a harmless read-only local agent request and retain only redacted event timing evidence in `.context/voice-demo/`. Test a ten-minute connection on Railway before treating the host choice as validated.

This milestone is a go/no-go for WebRTC in the Obsidian Electron runtime and for the transcript readiness rule. If WebRTC fails, test the documented WebSocket relay fallback and update this design with the measured cause. If client delegation cannot reliably supply usable context, test managed Responses delegation with a single structured local-task tool as a separate experiment; do not silently add Luna to the final architecture.

### Milestone 2: implement conversation and task ownership

Add the neutral types and coordinator, refactor the composer queue into that owner, and expose task outcomes from the session. Add provenance to store updates and link backend placeholders without duplicate user messages. Implement context delivery tracking and schema-2 persistence before audio UI work. Focused tests must show normal text behavior unchanged and prove that a hidden task answer survives save/load.

### Milestone 3: connect server delegation to all local backends

Implement the application protocol, auth, session limits, delegation mapping, sparse result updates, and failure handling. Use only the shared `AgentSession` boundary for work. Complete one delegated request with each backend. Exercise delayed transcript, duplicate notifications, busy queue, failed backend, and lost acknowledgments. Do not rely on mocks as evidence of OpenAI account/model access.

### Milestone 4: complete the product experience

Add `VoiceModeBar.tsx` and its adjacent stories, integrate the composer action, and render linked task details with existing message/activity components. Update `AgentChatMessages.stories.tsx` for mixed conversation, active speech while tools run, queued follow-up, approval, disconnected voice, and completed work after End voice. Add tests for switching in both directions and popout/view teardown. Match existing Tailwind and accessibility patterns.

### Milestone 5: deploy and demonstrate

Deploy the service to Railway with tester credentials, run the native acceptance sequence below, measure end-to-end latency and actual usage, and record the loaded plugin build and server revision. Add setup/usage documentation and update this document's Progress and Outcomes. The user waived issue creation for this branch, as recorded in `TODO.md`. See [tester setup](../docs/agent-mode-and-tools.md#voice-chat-demo) and the [verification record](VOICE_CHAT_DEMO_VERIFICATION.md) for the implemented setup and measured acceptance coverage.

From the separate server checkout, using Node 24:

    npm ci
    npm run typecheck
    npm test
    npm run build

From this plugin repository root:

    npm ci
    npm test -- --runInBand --testPathPattern='AgentVoice|VoiceModeBar|VoiceSessionController|VoiceConversationBridge|windowVoiceHost|voiceTranscript|AgentTaskCoordinator|AgentMessageStore|AgentChatPersistenceManager|AgentChatUIState|AgentChatInput|AgentChatMessages|AgentSessionManager|useAgentChatRuntimeState|commands/index.test|ChatInput.send|AgentSession.test'
    npm run build
    npm run gallery:vault
    npm run test:vault
    npm run format && npm run lint
    npm run review:obsidian
    git diff --check

The path filter above uses this checkout's Jest 29 syntax. Run gallery and native-vault commands only with the real configured test-vault path, then verify the loaded build. Never run `npm run dev`. Before source implementation, read the test and component-gallery guide; every new public production callable needs behavior coverage, and changed behavior should fail its test before the fix. Obsidian review errors block a PR; report nonblocking warnings without risky unrelated edits.

## Validation and acceptance

### Required automated behavior

Coordinator tests cover one active turn, existing typed queue behavior, clear-before-cancel, foreground-only dispatch, distinct speech requests, repeated delegation IDs, repeated typed submission IDs, stale result revisions, and pending transcript arrival. A settlement test proves a backend error cannot become a completed task merely because the UI wrapper resolved.

Store/render tests cover one public copy per user input, stable partial transcripts including whitespace and late fragments, fixed presentation across mode changes, explicit streaming identity, and visible approval/question/error controls inside a mixed conversation. Playback interruption must not call backend cancellation.

Persistence tests cover old chats, schema-2 round trips, answers hidden in task cards, native-resume overlay, project isolation, manually edited Markdown, corrupt/future metadata, save failure, autosave disabled, and interrupted tasks on reload. No reload test may trigger tool execution or recreate a Live call.

Transport/server tests cover authentication and ownership, creation deduplication, two connections becoming ready in either order, close during connection, dropped client/sideband, upstream error, session limits, bounded queues, cumulative usage, raw-audio discard, and credentials absent from logs. Use recorded redacted protocol fixtures and deterministic clocks for these contracts; keep paid API tests separate.

### Native end-to-end demo

For each of Claude, Codex, and OpenCode, open an existing text conversation and ask a harmless question about a note. Start voice, ask a follow-up referring to that answer, and observe the waveform and assistant transcript. Ask the agent to find relevant notes: exactly one local task starts and its raw answer stays inside its card. Type an exact search term while voice is active, then speak a clarification while the agent is busy; verify the typed input is not executed twice and the clarification is labelled queued.

Exercise a permission request and answer it through existing UI. Interrupt spoken output and verify local work continues. End voice during a slow read-only task, verify microphone capture stops, and wait for the task's result in its existing card. Type “use the option we just discussed” and verify recent voice context reaches the same backend session. Start voice again and verify it knows the current task facts without replaying an old task or answer announcement.

Save, reload Copilot, and reopen the mixed conversation. Verify public text, task answers, origin/presentation, and project ownership are retained; live-only activity is labelled unavailable. Repeat microphone denial, server disconnect, Stop with queued work, switching chats, popout closure, and reaching the ten-minute cap. Each failure should leave text chat usable and no orphan microphone stream.

Measure voice-click-to-ready, speech-end-to-first-audio, delegation-to-local-task-start, backend-result-to-spoken-result, close-to-microphone-release, and provider-reported usage. Initial demo goals are ready within five seconds on a warm server, local capture disabled immediately on End voice, and no duplicate dispatch or lost visible answer in the acceptance suite. Speech and delegation latency are measurements to report, not promises before the spike. Capture a native demo recording and exact revisions; passing unit tests alone is not end-to-end evidence.

## Idempotence and recovery

Deduplicate session creation and task submission by explicit IDs. Store acceptance before running work. Within a live plugin process, repeated requests return the original task mapping. Across crashes, do not claim exactly-once execution: an agent may have acted before the final acknowledgment was saved. Mark uncertain work interrupted and require an explicit new user request before retrying an operation.

End voice and cleanup are safe to call repeatedly. Server restart has no task replay mechanism. Plugin reload leaves voice off. Disabling the feature returns the text UI while retaining readable mixed-history content; keep the schema-2 reader available so rollback does not destroy saved conversations. A deployment rollback changes the service image, not the user's vault. Expire unclaimed sessions, close upstream on client loss, and use provider accounting to investigate any unconfirmed final charge.

## Surprises and discoveries

The API's delegation signal does not carry task text, and transcript fragments are not complete turns. This is the highest-risk integration boundary and is why the first milestone measures event ordering in Obsidian.

The existing chat UI derives streaming presentation from the last assistant row. Voice can add an assistant row while a backend task is still running, so task identity must replace that positional assumption.

The current Markdown persistence is intentionally display-oriented and does not restore structured parts. Simply adding fields to `AgentChatMessage` would not preserve voice/task relationships, and hiding messages through `isVisible` would affect autosave input.

The UI wrapper catches backend turn failures, so promise fulfillment is not an execution receipt. Explicit task settlement must drive spoken success claims.

Cloudflare's outgoing Live connection prevents Durable Object hibernation. Its free allowance remains attractive, but a pricing comparison based on idle inbound sockets would be misleading. Railway explicitly allows long-lived idle WebSockets, removing the suspected HTTP timeout obstacle.

## Decision log

September 10, 2026: Preserve one conversation and the selected local backend session across text/voice transitions. This matches the requested continuity and avoids replacing established vault integrations.

September 10, 2026: GPT-Live owns spoken conversational output during voice mode; local backend output is linked task detail. Task presentation is fixed at submission so mode changes cannot duplicate or relocate active answers.

September 10, 2026: Omit backend steering from the demo. Queue delegated follow-ups and preserve explicit Stop, because the shared backend contract has no uniform steering operation today.

September 10, 2026: Recommend direct client delegation to the selected agent, with transcript/context assembly in Copilot. Managed Luna routing remains a documented experiment if the initial boundary proves unreliable; it is not a hidden required dependency.

September 10, 2026: Recommend Railway and WebRTC plus server sideband. This minimizes runtime adaptation and custom media code. Cloudflare offers the stronger free allowance; reliability and actual cost still require measurements.

September 10, 2026: Use a single versioned Markdown snapshot for mixed-history persistence and keep autosave preferences. A digest-checked metadata comment preserves relationships without a separate transcript database; edited files degrade explicitly to readable history.

September 10, 2026: Bound the private demo to desktop, one voice conversation per plugin instance, one selected agent, ten-minute calls, and existing click-based approvals. These are implementation scope decisions introduced by this design.

## Outcomes and retrospective

The desktop product controls and shared task flow are implemented. Native Codex testing on September 11, 2026 connected in 1.8 seconds and accepted two spoken delegations in 505 ms and 501 ms. A 96-second call reported provider-confirmed usage with an estimated cost of $0.08. Four task answers survived ending voice and reloading the plugin. The tests also exposed and corrected stale ownership after disconnect and missing closing-state feedback.

OpenCode also completed one spoken read-only request using the user-selected `copilot-plus/copilot-plus-flash` model. Delegation acceptance took 505 ms and local task completion took 4,684 ms. Voice spoke the correct result, End voice stopped capture, and the completed card remained visible. Provider-confirmed usage was 62 seconds, estimated at $0.0517. A subsequent native check confirmed a typed follow-up recalled a nickname introduced only through speech. Stop also cancelled an active task and removed its queued follow-up without starting it. A reviewed 36-second captioned recording is available locally; it has no audio track and has not been published.

A later native call verified re-entry without replay and interruption of spoken output without cancelling the local task. The ten-minute warning arrived 539.317 seconds after readiness; voice was off with its capture track ended at the 599.916-second observation. Provider-confirmed usage was 598 seconds, estimated at $0.4983. A safe emulated question exercised the real permission rail and confirmed that speech did not approve it, while exposing a task-card status defect. Follow-up code connects that status and the composer's current attachments to spoken submissions and replaces the stale warning countdown with a one-minute notice. Native bundle `2ae84cb69cd9` then passed an actual OpenCode Flash edit-permission flow using a note selected only in the composer. The spoken request omitted its filename; the correct note was edited only after clicking Allow once. The task card showed Needs your input while permission was pending, and spoken acknowledgment stayed queued until approval. End voice immediately stopped capture. The final dark and light galleries each passed 68 renders without overflow or rendering failures and confirmed the one-minute notice at 09:25 elapsed. Saving and loading the edited-note conversation into a new native session restored all six messages and both completed cards, including the edit answer's file link, with historical activity unavailable and voice off.

The [verification record](VOICE_CHAT_DEMO_VERIFICATION.md) separates native acceptance, component rendering, unit coverage and the prior server soak. The expanded focused suite passes 618 tests across 20 suites. Native testing uses synthesized microphone input through the real WebRTC connection and actual local backend. Claude voice delegation also reached the real backend and surfaced its account-quota failure in one task card, with spoken acknowledgment of failure. This does not establish successful Claude execution, human speech quality, or completion of the remaining backend and full acceptance matrix.

## Artifacts and notes

Keep redacted native test evidence under `.context/voice-demo/` during implementation. Record server/plugin revisions, backend versions, the actual loaded test vault, event timing, usage totals, and observed failures. Never store credentials or audio recordings there without a deliberate user-facing recording workflow. Official API and hosting links above support the September 10 research snapshot; recheck schemas and prices before implementation because Live is evolving.

Revision note: Initial design created September 10, 2026. Product requirements from the conversation are separated from engineering choices introduced to make the demo concrete.
