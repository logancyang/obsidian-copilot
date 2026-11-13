# Nomenclature

The words Copilot shows users. Each concept has one plain name; use it in UI labels, tooltips, notices, errors, and user docs. Code identifiers, setting keys, IDs, logs, and anything persisted keep their internal names.

| Concept                                                   | Use                                                       | Never show users                      |
| --------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------- |
| One conversation with an agent                            | chat                                                      | session, conversation                 |
| The agent chat screen                                     | Agent Chat (Copilot Agent Chat in command and view names) | Agent Mode                            |
| Claude, Codex, OpenCode                                   | agent                                                     | backend                               |
| The agent picker in settings                              | Default agent                                             | Default backend                       |
| OpenCode                                                  | OpenCode                                                  | opencode, Opencode                    |
| An agent's install                                        | installation                                              | binary                                |
| The debug log                                             | Agent activity log                                        | frame log, Agent Mode activity log    |
| Where failure details are                                 | the Copilot log                                           | console                               |
| Bringing an agent up to date                              | Update                                                    | Upgrade                               |
| A failed reply                                            | `<agent>` ran into a problem                              | session error, backend error          |
| An agent that quits                                       | `<agent>` stopped unexpectedly                            | backend exited                        |
| Closing a chat's tab                                      | Close tab                                                 | Close chat                            |
| Stopping a chat's agent from a chat list                  | Shut down                                                 | Close chat, Close session, Stop agent |
| A chat whose agent is running                             | Running                                                   | Session open, Session live            |
| A chat whose agent is replying                            | Responding                                                | Running                               |
| Custom commands                                           | command, Add command, Slash menu, Right-click             | Cmd, Add Cmd, Slash Cmd, In Menu      |
| Saved chats                                               | Saving chats, chat note                                   | conversation                          |
| Notes, folders, and other items a project uses as context | link, Linked, Link context, Unlink                        | inclusion, context source             |
| Connecting the plugin to a Copilot website account        | Sign in, Sign out, Copilot account                        | Log in, login, OAuth, connect         |

## Rules

- Labels use sentence case: `Add command`, not `Add Command`.
- Say what happened in the user's terms. No internal class, API, or protocol names in messages.
- A new user-visible concept gets a row here in the same change that names it.
