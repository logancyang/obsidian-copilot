# Nomenclature

The words Copilot shows users. Each concept has one plain name; use it in UI labels, tooltips, notices, errors, and user docs. Code identifiers, setting keys, IDs, logs, and anything persisted keep their internal names.

| Concept                                                     | Use                                                      | Never show users                      |
| ----------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------- |
| One conversation with an agent                              | chat                                                     | session, conversation                 |
| The chat screen                                             | chat (Copilot Chat in command and view names)            | Agent Chat, Agent Mode                |
| Claude, Codex, OpenCode                                     | agent; the product's name where a teammate is also meant | backend, coding agent                 |
| The feature that lets the user make their own teammates     | Copilot Teammates, with a singular verb                  | custom agents, Copilot Teammate       |
| One the user made                                           | teammate                                                 | agent, custom agent                   |
| A chat with no teammate picked                              | Copilot                                                  | plain Copilot chat, Classic agent     |
| Asking a teammate from a chat                               | `@`, `Asking`, `Messaged`, `Message from`                | relay, run, hidden chat, fan-out      |
| What a teammate reads at the start of every chat            | instruction                                              | instructions file, prompt, persona    |
| What a teammate keeps from the user's corrections           | memory, rule, `remembered`                               | save row, saved memory                |
| A teammate's picture, its line under the name, its page     | face, title, profile                                     | avatar, subtitle                      |
| Everything an agent says between two of the user's messages | response                                                 | turn, run                             |
| A teammate whose model can't run on this device             | Needs setup                                              | setup-locked                          |
| Whether the user has the feature                            | a valid Supporter license; Supporter preview             | entitlement, license feature          |
| The agent picker in settings                                | Default agent                                            | Default backend                       |
| OpenCode                                                    | OpenCode                                                 | opencode, Opencode                    |
| An agent's install                                          | installation                                             | binary                                |
| The debug log                                               | Agent activity log                                       | frame log, Agent Mode activity log    |
| Where failure details are                                   | the Copilot log                                          | console                               |
| Bringing an agent up to date                                | Update                                                   | Upgrade                               |
| A failed reply                                              | `<agent>` ran into a problem                             | session error, backend error          |
| An agent that quits                                         | `<agent>` stopped unexpectedly                           | backend exited                        |
| Closing a chat's tab                                        | Close tab                                                | Close chat                            |
| Stopping a chat's agent from a chat list                    | Shut down                                                | Close chat, Close session, Stop agent |
| A chat whose agent is running                               | Running                                                  | Session open, Session live            |
| A chat whose agent is replying                              | Responding                                               | Running                               |
| Custom commands                                             | command, Add command, Slash menu, Right-click            | Cmd, Add Cmd, Slash Cmd, In Menu      |
| Saved chats                                                 | Saving chats, chat note                                  | conversation                          |
| Notes, folders, and other items a project uses as context   | link, Linked, Link context, Unlink                       | inclusion, context source             |

## Rules

- Labels use sentence case: `Add command`, not `Add Command`.
- Say what happened in the user's terms. No internal class, API, or protocol names in messages.
- A new user-visible concept gets a row here in the same change that names it.
