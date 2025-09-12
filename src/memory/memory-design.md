# User Memory Management Flow (Current)

## Overview

Current design for how the user memory system works in Obsidian Copilot, focusing on recent conversation memory only. Long-term memory features like user insights have been removed to simplify the system.

## Flow Diagram

```mermaid
graph TD
    %% Triggers for Memory Updates
    A[Chat Conversation Ends] --> B[updateUserMemory called]
    B --> C{Memory Enabled?}
    C -->|Yes| D[Extract conversation summary and condensed user messages<br/>Format: timestamp summary||||condensed_user_msg1,condensed_user_msg2,...]
    C -->|No| Z[Skip Memory Update]

    %% Recent Memory Only (Simplified)
    D --> E[Rolling Buffer Policy - Count Based]
    E --> F[Keep last 40 conversations max]
    F --> G[Save to recent_conversation_content.md]
    G --> H[Memory Update Complete]
```

## Key Points

### Memory Update Triggers:

- **Trigger**: When a chat conversation ends and `updateUserMemory()` is called
- **Guard**: Only if `enableMemory` setting is on

### Recent Conversations (Current Implementation):

- **When**: Updated after every conversation
- **Retention policy**: Fixed rolling buffer - keeps last 40 conversations maximum
- **Content**: Timestamp + brief conversation summary + condensed user message excerpts
- **Format**: `- {timestamp} {summary}||||{condensed_user_msg1},{condensed_user_msg2},...`
- **Storage**: `recent_conversation_content.md` in the configured memory folder

### Configuration (Current):

- **`enableMemory`**: Master switch for all memory functionality
- **`memoryFolderName`**: Folder where memory files are stored

### Removed Features:

- **Long-term Memory**: User insights, response preferences, and topic highlights have been removed
- **Complex Update Logic**: No more threshold-based updates or insight extraction
- **Multiple Memory Types**: Simplified to only recent conversations

This simplified design focuses on providing recent conversation context without the complexity of long-term memory management.
