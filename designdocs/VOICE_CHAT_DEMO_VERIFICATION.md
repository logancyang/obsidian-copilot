# Voice chat demo verification

This record covers the September 11, 2026 desktop demo. The feature is implemented; the full acceptance sequence in [the design](VOICE_CHAT_DEMO_DESIGN.md#native-end-to-end-demo) is not yet complete. Follow [tester setup](../docs/agent-mode-and-tools.md#voice-chat-demo) to configure the demo.

## Revisions and environment

| Item                       | Recorded value                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| Plugin implementation      | `8f0e47d0`, branch `zeroliu/voice-chat-brainstorm-v1`                                       |
| Loaded build after commit  | `4.0.7+dev.8f0e47d0.clean.b1455c65625a`                                                     |
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
| Save and reload                        | All 12 messages and four completed task answers restored; historical activity labelled unavailable                                                                                                | Native edited-file and project-isolation sequences pending                         |
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

Permission and plan decisions, barge-in without backend cancellation, re-entry without replay, the ten-minute warning and closure in Obsidian, and the complete sequence for every backend remain acceptance items. Unit coverage of those contracts does not mark them natively verified.

## Automated and component checks

The focused plugin suite passed 428 tests. The exact Jest filter and build/gallery commands are in [the design](VOICE_CHAT_DEMO_DESIGN.md#milestone-5-deploy-and-demonstrate). Production build, formatting, lint and Obsidian review passed. Three pre-existing lint warnings and existing nonblocking Obsidian warnings remain.

The native component gallery rendered 17 states at four widths in each theme, 68 renders per theme. No overflow, render errors or zero-size containers were observed. Remaining audit diagnostics concern disabled End-button contrast and the audit parser's unsupported inherited `oklch` background on existing user-message styling. This is not a claim of a clean accessibility audit.

The separate server suite passed 162 tests during this session. Server tests and plugin tests are distinct from native backend acceptance.

## Prior Railway soak

The server repository's `docs/DEPLOY.md` records a real ten-minute call on September 11, 2026. Its Node WebRTC client streamed silent audio. The warning arrived at 540.0 seconds and the server deadline closed the call at 600.7 seconds. Provider usage reported 583 connected seconds and an estimated $0.4858. This establishes the prior server/host deadline and connection result; it does not verify the ten-minute warning or microphone teardown in the current Obsidian UI.

A deployment or process restart ends active calls. The service uses one replica, a ten-minute call limit, and one concurrent call per tester credential. Operators should use the server repository's deployment instructions and run acceptance between deployments.
