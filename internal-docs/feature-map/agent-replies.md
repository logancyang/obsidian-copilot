# Agent replies

How a reply appears in a conversation: streaming text, reasoning, tool and activity cards, subagents, and tasks.

## Sub-features

- reply-stream: the reply's text appears as the agent writes it.
- reply-duration: `Agent is working` with a timer while the turn runs, then `Worked for <time>`.
- reply-reasoning: `Reasoning...` while the agent thinks, then `Thought for <time>`; expand it to read the reasoning.
- reply-activity: the agent's tool calls collapse into a one-line summary; expand it to see each step.
- reply-plan: the agent's `Plan` checklist, with each step's progress.
- reply-subagents: a subagent's card shows its `Prompt` and what it did.
- reply-tasks: a background task or command shows as a card; open it to see its output, then `Back to chat`.
- reply-multi-agent: a message that mentions other agents shows `Agent answers` from each, then a summary.
- reply-compaction: `Compacting conversation…`, then `Context compacted` or `Context compacted automatically`.
- reply-files-changed: a turn that edited notes ends with its [turn diffs](turn-diffs.md).
- reply-actions: `Copy` and `Insert / Replace at cursor` under a finished reply.

Only the sub-features are mapped so far, and they may not cover everything this feature does. To map the rest, follow [`FEATURE_MAP_GUIDE.md`](../FEATURE_MAP_GUIDE.md).
