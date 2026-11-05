# Feature map

How features relate and where changes go wrong. Each file covers one user-facing feature: the model a change must keep, how it connects to other features, and its pitfalls. Read the file for any feature a change touches, including features that share its state.

Entries hold only what the code cannot tell you: intent, cross-feature rules, and traps. File lists, call chains, and step-by-step behavior belong in the code and its tests.

| Feature                                       | Covers                                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [Agent chat sessions](agent-chat-sessions.md) | When an agent session opens, stays live, and is released across tabs, the Navigator, history, and projects |
