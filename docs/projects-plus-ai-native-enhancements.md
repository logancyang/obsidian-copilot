# Projects+ AI-Native Enhancements

> Post-MVP roadmap for making Projects+ more AI-native

---

## Design Principles

1. **Proactive Intelligence**: AI surfaces suggestions when it notices relevant changes (new notes, approaching deadlines, completed criteria) rather than waiting for users to ask
2. **Dual Interface**: Conversational and traditional UI coexist as equals—users choose their preferred interaction mode
3. **Outcome-Oriented**: Focus on what the user wants to achieve, not on filling forms
4. **Contextual Awareness**: AI maintains continuity across sessions and references past conversations

---

## Enhancement Areas

### 1. Home Screen: Intelligent Surface

**Current MVP**: Static project list sorted by last active, search box

**Enhancement**: Add agent-driven suggestions alongside the project list

```
┌─────────────────────────────────────┐
│  🎯 Projects+                  ⚙️   │
├─────────────────────────────────────┤
│                                     │
│  ┌─ AI Suggestion ─────────────────┐│
│  │ 🤖 3 new notes about React      ││
│  │    since yesterday. Add to      ││
│  │    "Build portfolio website"?   ││
│  │                                 ││
│  │    [Yes, add them] [Dismiss]    ││
│  └─────────────────────────────────┘│
│                                     │
│  ─────────────────────────────────  │
│                                     │
│  SUGGESTED FOCUS                    │
│  ┌─────────────────────────────────┐│
│  │ Build portfolio website         ││
│  │ ⚠️ Deadline in 5 days           ││
│  │ "Haven't discussed deployment"  ││
│  └─────────────────────────────────┘│
│                                     │
│  ALL PROJECTS                       │
│  (existing project list below)      │
│                                     │
└─────────────────────────────────────┘
```

**Implementation Notes**:

- Add `ProjectSuggestionBanner` component above project list
- Triggers: new notes matching project keywords, approaching deadlines, long inactivity
- Suggestions are dismissible and don't block access to project list
- Track dismissed suggestions to avoid repetition

**Suggested Triggers**:
| Trigger | Suggestion |
|---------|------------|
| New vault notes match project | "3 new notes about X. Add to project?" |
| Deadline within 7 days | Surface project as "Suggested Focus" |
| No activity in 7+ days | "Haven't worked on X in a while. Continue?" |
| Success criteria likely met | "Looks like you've completed your criteria..." |

---

### 2. Project Detail: Contextual Greeting

**Current MVP**: Static sections (Action, Conversations, Notes)

**Enhancement**: Add AI greeting with situational awareness, keep traditional sections as supporting context

```
┌─────────────────────────────────────┐
│  ← Projects  Build portfolio website│
├─────────────────────────────────────┤
│                                     │
│  ┌─ Session Context ───────────────┐│
│  │ 🤖 Since your last session:     ││
│  │ • 2 new relevant notes found    ││
│  │ • 2/4 success criteria done     ││
│  │                                 ││
│  │ "Deployment is the main gap.    ││
│  │  Ready to discuss strategies?"  ││
│  │                                 ││
│  │ [Discuss deployment] [Not now]  ││
│  └─────────────────────────────────┘│
│                                     │
│  ═══════════════════════════════    │
│                                     │
│  (existing MVP sections below:      │
│   Action, Conversations, Notes)     │
│                                     │
└─────────────────────────────────────┘
```

**Implementation Notes**:

- Add `ProjectContextBanner` component at top of Project Detail
- Computes: new notes since last visit, success criteria progress, conversation gaps
- Suggests next action based on gaps
- Collapsible after first interaction

**Context Signals to Track**:

- Last visit timestamp per project
- Notes created/modified since last visit
- Success criteria mentioned in conversations
- Topics not yet discussed

---

### 3. Note Management: Conversational Mode

**Current MVP**: Checkbox-based note selection with AI suggestions

**Enhancement**: Add conversational interface as alternative to checkbox UI

```
┌─────────────────────────────────────┐
│  ✕           Manage Notes           │
├─────────────────────────────────────┤
│  [Conversational] [Browse Vault]    │  ← Tab switcher
├─────────────────────────────────────┤
│                                     │
│  CONVERSATIONAL TAB:                │
│  ┌─────────────────────────────────┐│
│  │ 🤖 12 notes assigned. What      ││
│  │    would you like to do?        ││
│  │                                 ││
│  │ Examples:                       ││
│  │ • "Add my CSS notes"            ││
│  │ • "Remove old notes"            ││
│  │ • "Find notes about responsive" ││
│  └─────────────────────────────────┘│
│                                     │
│  User: "Add my recent React notes"  │
│                                     │
│  🤖 Found 3 React notes from this   │
│     week:                           │
│                                     │
│  [+] React Hooks Patterns (95%)     │
│  [+] Component Design (87%)         │
│  [ ] React Testing (62%)            │
│                                     │
│  "Pre-selected top 2. Add these?"   │
│                                     │
│  [Add selected] [Show all matches]  │
│                                     │
├─────────────────────────────────────┤
│  ┌─────────────────────────────┐    │
│  │ What notes to add...        │ ➤  │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

**Implementation Notes**:

- Add tab switcher between "Conversational" and "Browse Vault" modes
- Conversational mode uses chat-style interface
- AI interprets intent and shows pre-selected results
- User can switch to traditional browse mode anytime
- Actions from either mode update the same note list

**Supported Intents**:
| Intent | AI Action |
|--------|-----------|
| "Add my X notes" | Search vault for X, pre-select high matches |
| "Remove old notes" | Show notes by age, suggest removal |
| "Find notes about X" | Search and show matches with relevance |
| "Show all notes" | Switch to Browse Vault tab |

---

### 4. Completion: Agent-Initiated

**Current MVP**: User clicks "Complete" button → confirmation dialog

**Enhancement**: AI detects success criteria completion and proactively suggests

```
┌─────────────────────────────────────┐
│  ← Projects  Build portfolio website│
├─────────────────────────────────────┤
│                                     │
│  ┌─ Completion Suggestion ─────────┐│
│  │ 🎉 It looks like you've hit     ││
│  │    your success criteria!       ││
│  │                                 ││
│  │ ✓ Live site deployed            ││
│  │   (mentioned in Dec 28 chat)    ││
│  │ ✓ 3-4 projects showcased        ││
│  │   (discussed in Dec 26 chat)    ││
│  │ ✓ Mobile responsive             ││
│  │   (confirmed in Dec 24 chat)    ││
│  │                                 ││
│  │ Ready to mark complete?         ││
│  │                                 ││
│  │ [Complete project]              ││
│  │ [Generate reflection first]     ││
│  │ [Not yet]                       ││
│  └─────────────────────────────────┘│
│                                     │
│  (rest of Project Detail below)     │
│                                     │
└─────────────────────────────────────┘
```

**Implementation Notes**:

- After each conversation, AI analyzes if success criteria keywords appear
- Track criteria as "likely complete" when confidence > 80%
- Show completion suggestion when all criteria likely met
- "Generate reflection" creates summary from conversation history
- User can dismiss and complete manually later via existing button

**Criteria Detection**:

- Parse success criteria into semantic chunks
- After each conversation, check if chunks are addressed
- Store confidence score per criterion
- Trigger suggestion when all criteria > 80% confidence

---

### 5. Auto-Generated Reflections

**Current MVP**: User manually writes reflection in textarea

**Enhancement**: AI generates reflection from conversation history

```
┌─────────────────────────────────────┐
│  ✕ Cancel      Complete Project     │
├─────────────────────────────────────┤
│                                     │
│  ┌─ Generated Reflection ──────────┐│
│  │ 🤖 Here's a reflection based on ││
│  │    your journey:                ││
│  │                                 ││
│  │ "Over 14 days, I explored React ││
│  │  component patterns and landed  ││
│  │  on a composition-based         ││
│  │  approach. The CSS Grid guide   ││
│  │  was particularly helpful for   ││
│  │  responsive layouts. Key        ││
│  │  learning: start with mobile    ││
│  │  breakpoints first."            ││
│  │                                 ││
│  │ [Edit] [Regenerate]             ││
│  └─────────────────────────────────┘│
│                                     │
│  Or write your own:                 │
│  ┌─────────────────────────────────┐│
│  │                                 ││
│  └─────────────────────────────────┘│
│                                     │
│  [Complete with reflection]         │
│  [Complete without reflection]      │
│                                     │
└─────────────────────────────────────┘
```

**Implementation Notes**:

- When user clicks "Generate reflection", summarize all project conversations
- Extract: topics discussed, notes referenced, key decisions, time spent
- Make reflection editable
- User can still write from scratch if preferred

---

### 6. New Note Detection

**Background Process**: When user creates/modifies notes, check relevance to active projects

**Behavior**:

1. On note save, compute similarity to active project descriptions
2. If relevance > threshold, queue suggestion
3. Surface on next Home Screen visit (see Enhancement #1)

**Implementation Notes**:

- Hook into Obsidian's file modification events
- Use same embedding/similarity logic as note assignment
- Store pending suggestions in project metadata
- Clear suggestion when user acts on it or dismisses

---

### 7. Conversation Continuity

**Enhancement**: AI references past conversations in new sessions

```
User: "What about CSS Grid?"

🤖 "Last time (Dec 26), you decided to use CSS Grid
    for the main layout. You mentioned wanting to
    avoid Flexbox for the outer structure.

    Want to revisit that, or explore something new?"
```

**Implementation Notes**:

- When user asks about a topic, search past conversations
- If relevant past discussion found, reference it
- Include date and key decision points
- Helps maintain continuity across sessions

---

### 8. Project Suggestion from Main Chat

**Enhancement**: When discussing project-like topics in main Copilot chat, suggest creating a project

```
User (in main Copilot): "I want to learn Kubernetes
for my job next month"

🤖 "That sounds like a project! Would you like to
    create one in Projects+? I can help you:
    • Define success criteria
    • Find relevant notes in your vault
    • Track your progress

    [Create project] [Just chat for now]"
```

**Implementation Notes**:

- Add intent detection to main Copilot chat
- Trigger on patterns: "I want to...", "I need to...", "My goal is..."
- Offer to create project without forcing it
- If declined, continue normal chat

---

## Implementation Priority

### Phase 1: Quick Wins (1-2 days each)

| Feature                                 | Effort | Impact |
| --------------------------------------- | ------ | ------ |
| Project Context Banner (Project Detail) | Low    | High   |
| Suggested Focus section (Home)          | Low    | Medium |
| Auto-generated reflections              | Medium | Medium |

### Phase 2: Core AI Features (3-5 days each)

| Feature                        | Effort | Impact |
| ------------------------------ | ------ | ------ |
| New Note Detection             | Medium | High   |
| Agent-initiated completion     | Medium | High   |
| Conversational note management | High   | Medium |

### Phase 3: Advanced (1+ week)

| Feature                           | Effort | Impact |
| --------------------------------- | ------ | ------ |
| Conversation continuity           | High   | Medium |
| Project suggestion from main chat | High   | Medium |
| Success criteria tracking         | High   | High   |

---

## Success Metrics

- **Engagement**: % of sessions where user acts on AI suggestion
- **Completion Rate**: Projects marked complete / projects created
- **Note Relevance**: User acceptance rate of suggested notes
- **Conversation Depth**: Messages per conversation session
- **Return Rate**: Users who return to project within 7 days

---

## Open Questions

1. How persistent should AI suggestions be? (dismiss once vs. resurface later)
2. Should success criteria tracking be explicit (AI asks "did you complete X?") or inferred?
3. How to handle conflicting signals (user says "done" but criteria not detected)?
