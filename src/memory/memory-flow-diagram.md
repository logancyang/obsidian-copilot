# User Memory Management Flow (Planned)

## Overview

Planned design for how the user memory system should work in Obsidian Copilot, including triggers, short-term retention policy, and long-term memory types.

## Flow Diagram

```mermaid
graph TD
    %% Triggers for Memory Updates
    A[Chat Conversation Ends] --> B[handleNewChat called]
    B --> C{Memory Enabled?}
    C -->|Yes| D[Append last conversation to Recent<br/>Format: timestamp topic user_msg1,user_msg2,...]
    C -->|No| Z[Skip Memory Update]

    %% Short-term (Recent) Memory
    D --> E{Configurable Rolling Window Policy}
    E -->|Count based: N items| F[Trim to last N]
    E -->|Time based: T days| G[Drop entries older than T]
    F --> H[Save to recent_conversations.md]
    G --> H[Save to recent_conversations.md]

    %% LTM Update Decision happens AFTER recent update
    H --> I{Check Long-Term-Memory Update Needed?}
    I -->|Yes| J[Extract & Classify Long-term Signals]
    I -->|No| Y[Skip LTM Update]

    %% Long-term (Persistent) Memory Types
    J --> K[User Insights <br/>LONG-TERM characteristics about the user]
    J --> L["Response Preferences (V2?)"]
    J --> M["Topic Highlights (V2?)"]

    K --> K2[Upsert user_insights.md]
    L --> L2[Upsert response_preferences.md]
    M --> M2[Upsert topic_highlights.md]
```

## Key Points

### Memory Update Triggers:

- **Trigger**: When a chat conversation ends and `handleNewChat()` is called
- **Guard**: Only if `enableMemory` setting is on

### Recent Conversations (Short-term):

- **When**: Updated after every conversation
- **Retention policy**: Rolling window is user-configurable by either count (keep last N items) or time (keep items within T days, e.g., 7 days)
- **Content**: Timestamp + brief summary + user message excerpts
- **Storage**: Example file `recent_conversations.md`

### Long-term Memory (Persistent):

- **Update check**: After recent memory is updated, evaluate whether LTM should be updated (e.g., new persistent info detected, thresholds reached)
- **Types**: `user_insights` (facts about the user), `response_preferences` (format/tone/style), `topic_highlights` (recurring themes)
- **Storage**: Separate files, e.g., `user_insights.md`, `response_preferences.md`, `topic_highlights.md`
- **Behavior**: Upsert with deduplication and timestamps; per-type enablement is possible

### Configuration (proposed):

- **`enableMemory`**: Master switch
- **`recentWindowType`**: `count` | `time`
- **`recentMaxItems` / `recentMaxAgeDays`**: Applies based on window type
- **`enableLTMemoryTypes`**: Toggle per type `{ user_insights, response_preferences, topic_highlights }`
- **`ltmUpdatePolicy`**: Heuristic or schedule to decide when LTM updates run

This planned design ensures recent context stays concise and fresh while selectively promoting durable knowledge into well-structured long-term categories.
