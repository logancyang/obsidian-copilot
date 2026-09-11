# Voice chat demo verification

This record covers the September 11, 2026 desktop demo. The feature is implemented; the full acceptance sequence in [the design](VOICE_CHAT_DEMO_DESIGN.md#native-end-to-end-demo) is not yet complete. Follow [tester setup](../docs/agent-mode-and-tools.md#voice-chat-demo) to configure the demo.

## Revisions and environment

| Item                       | Recorded value                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| Plugin implementation      | `8f0e47d0`, branch `zeroliu/voice-chat-brainstorm-v1`                                       |
| Loaded build after commit  | `4.0.7+dev.8f0e47d0.clean.b1455c65625a`                                                     |
| Follow-up native bundle    | `2ae84cb69cd9`, including composer context and permission-status fixes                      |
| Earlier native Codex build | `c063f58c-dirty-b1455c65625a`, matching the committed implementation bundle hash            |
| Runtime                    | Native Obsidian desktop on macOS, real local agent processes and OpenAI WebRTC              |
| Speech input               | Synthesized speech injected into the microphone media stream; no human speech quality claim |
| Server checkout            | Separate `zeroliu/copilot-voice`, revision `c43f3da`                                        |
| Service endpoint           | `https://voice-server-production-be4b.up.railway.app`                                       |
| Server status              | `/readyz` passed during this session; this is configuration readiness, not a paid call test |

Temporary probes, timing logs and test output are under `.context/voice-demo/`. Keep credentials, private note content and unapproved recordings out of committed evidence.

## Native results

| Check                                  | Evidence                                                                                                                                                                                          | Remaining limit                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Codex spoken delegation                | Real WebRTC speech produced accepted local tasks in 505 ms and 501 ms                                                                                                                             | These measure delegation receipt to acceptance, not total speech-to-answer latency |
| Warm connection                        | Ready in 1,819 ms                                                                                                                                                                                 | One measured call, not a latency percentile                                        |
| Typed submission during voice          | One task for one typed submission                                                                                                                                                                 | Full attachment/context acceptance sequence remains pending                        |
| Mute                                   | Microphone track disabled while the call remained active                                                                                                                                          | Human listening test pending                                                       |
| End voice with running and queued work | Capture tracks stopped synchronously in 1.5 ms; closing state shown; accepted tasks finished in their same cards                                                                                  | Native operating system microphone indicator not separately recorded               |
| Save and reload                        | All 12 messages and four completed task answers restored; historical activity labelled unavailable                                                                                                | Native manually edited history-file and project-isolation sequences pending        |
| Forced control disconnect              | Visible error, followed by successful explicit restart                                                                                                                                            | Simulated control loss; server restart and network outage not separately exercised |
| Microphone denial                      | Simulated permission rejection showed an error and left voice off                                                                                                                                 | Does not establish native operating system permission-dialog behavior              |
| Popout ownership                       | Moving the view ended the old call; the popout opened voice and stopped capture when detached                                                                                                     | Full chat/project/backend switching sequence pending                               |
| Usage                                  | Codex: provider-confirmed 96 connected seconds, estimated $0.08. OpenCode: provider-confirmed 62 seconds, estimated $0.0517                                                                       | Estimates exclude agent inference and hosting; not invoices                        |
| Claude delegated task                  | One spoken delegation accepted in 503 ms; one task card settled failed after 2.5 seconds with the real account limit error; spoken assistant acknowledged failure                                 | Typed baseline hit the same quota; successful Claude execution remains blocked     |
| OpenCode delegated task                | On `copilot-plus/copilot-plus-flash`, one spoken read-only request produced one task; accepted in 505 ms, completed in 4,684 ms with the correct fixture reference code; voice spoke confirmation | This run covers a read-only request, not the complete per-backend sequence         |
| Local demo recording                   | Reviewed local 36-second video, 1350 × 1200, approximately 3.6 MB; captions explain synthesized speech; all three final storyboard sheets visually reviewed                                       | Video-only, no audio track; kept local and not published                           |

The OpenCode run measured remote audio with a peak RMS of 0.128. End voice immediately stopped capture and retained the completed card. Its selected model was verified in the live session before the spoken request. Evidence is in `.context/voice-demo/product-opencode.json`; Claude failure-path evidence is in `.context/voice-demo/product-claude.json`.

Two further native OpenCode Flash checks passed:

- After a spoken exchange introduced the session-only nickname Bluejay, End voice returned to text mode. A typed question asking for the nickname received the correct answer. The nickname was absent from the fixture, so the result demonstrates delivery of recent spoken context to the backend.
- A typed shell task running a 30-second sleep was active while a second typed follow-up appeared in the queue. Clicking **Stop generating** removed the queued row and the active task settled cancelled. The queued task never started, including after the original 30-second deadline. A new typed request after Stop completed correctly in two seconds, confirming text chat remained usable.

Evidence is in `.context/voice-demo/product-continuity-stop.json`. The reviewed recording is `.context/voice-demo/voice-demo-final.mp4`; it remains a local artifact.

Further native checks on `8f0e47d0` passed:

- Voice re-entry remained silent for 44.065 seconds without adding messages or delegations, then recalled the prior Bluejay nickname without starting a local task.
- Barge-in interrupted a spoken story while the same read-only OpenCode task kept running. The task completed with `BARGE_DONE` after 100,614 ms, without cancellation or a second delegation. Evidence is in `.context/voice-demo/product-barge-mid.json` and `product-barge-final.json`.
- The ten-minute warning arrived 539.317 seconds after client readiness. Voice was off and its capture track ended at the 599.916-second observation. Playback stopped, the timer stopped, and no error remained. Provider-confirmed usage was 598 seconds, estimated at $0.4983. Evidence is in `.context/voice-demo/product-native-soak.json`.

An emulated backend question first reproduced a task-card status defect: the real action rail awaited a decision while the task card still said Working. Spoken "Yes, continue" did not resolve the question. The same soak exposed a one-time warning displayed as a stale countdown. Both defects were corrected and verified below.

The final native bundle `2ae84cb69cd9` passed an actual OpenCode Flash attachment and edit-permission sequence:

- A fresh session used Safe mode without changing the saved default. The tester selected a disposable note through the composer's Notes picker and removed the active-note reference.
- The spoken request asked to change the attached note's canvas color from red to blue without naming its file. OpenCode requested edit permission for that attached file, confirming the spoken task received composer context.
- The task state became `awaiting-user` and its card displayed "Needs your input." Spoken "Yes, continue" left the permission pending and the file unchanged. Clicking **Allow once** changed the task back to running; it completed with the correct linked answer and the file changed to blue.
- The spoken acknowledgment became a queued follow-up and ran only after the on-screen approval. End voice immediately ended the capture track, and the temporary probe was restored.

The edited-note conversation also passed a fresh-session persistence check. After saving, the tester explicitly closed its native session and loaded the saved conversation into a new internal session. All six messages and two completed task cards restored; both cards reported historical activity unavailable, the edit answer retained its file link, and voice stayed off. This covers persistence after the OpenCode edit workflow, not manual modification of the saved chat's metadata. Evidence is in `.context/voice-demo/product-attachment-reload.json`.

Evidence is in `.context/voice-demo/product-real-approval-before.json` and `product-attachment-approval-green.json`. This establishes a real OpenCode tool-permission flow; Claude and Codex permission flows, plan decisions, human speech quality, and the complete sequence for every backend remain acceptance items. Native attachment coverage here is for a note; image, selection and explicit web-tab context have automated coverage.

## Automated and component checks

The original UI milestone passed 428 focused tests. The follow-up suite passed 618 tests across 20 suites, adding the full AgentSession suite and the shared ChatInput send/snapshot suite to the design's filter. The exact Jest filter and build/gallery commands are in [the design](VOICE_CHAT_DEMO_DESIGN.md#milestone-5-deploy-and-demonstrate). Production build, formatting, lint and Obsidian review passed. Three pre-existing lint warnings and existing nonblocking Obsidian warnings remain.

The original native component gallery rendered 17 states at four widths in each theme, 68 renders per theme. No overflow, render errors or zero-size containers were observed. Remaining audit diagnostics concern disabled End-button contrast and the audit parser's unsupported inherited `oklch` background on existing user-message styling. This is not a claim of a clean accessibility audit.

The final bundle's dark and light galleries each completed 68 renders without overflow, rendering errors or zero-size containers. Dark-theme warnings concern four instances of contrast on the disabled End voice button in the Closing state. Light-theme diagnostics retain that contrast limitation and the audit parser's unsupported inherited `oklch` background. The 09:25 warning story was visually inspected in both themes and displayed "Voice ends within a minute." The tester restored the dark theme.

The separate server suite passed 162 tests during this session. Server tests and plugin tests are distinct from native backend acceptance.

## Prior Railway soak

The server repository's `docs/DEPLOY.md` records a real ten-minute call on September 11, 2026. Its Node WebRTC client streamed silent audio. The warning arrived at 540.0 seconds and the server deadline closed the call at 600.7 seconds. Provider usage reported 583 connected seconds and an estimated $0.4858. This establishes the prior server/host deadline and connection result. The separate current-build Obsidian deadline and microphone teardown check is recorded above.

A deployment or process restart ends active calls. The service uses one replica, a ten-minute call limit, and one concurrent call per tester credential. Operators should use the server repository's deployment instructions and run acceptance between deployments.
