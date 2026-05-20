# ACP Agent Mode TODOs

- P0: Chat history
  - [x] Load chat history from agents
  - [x] Save chat history to notes
- [x] P0: Thoroughly assess whether migrating to Anthropic agent SDK is worth it.
- [ ] P0: Test Windows devices
- [ ] P0: Make sure bash command shows what command it runs (visibility)
- [ ] P0: Provide copilot specific system prompt
  - [ ] Allow users to share system prompt
  - [ ] Do a quick spike on the concrete behavior
  - [ ] Investigate opencode provider specific prompt
- [x] P0: Skills
  - [x] Check out cc-switch to understand how to make skills compatible cross other agents https://github.com/farion1231/cc-switch
- [ ] P0: Permission management
  - [ ] Permission UI improvement
  - [ ] Permission "always allow" doesn't seem to persist
- [ ] P0: How to design the settings to configure the provider?
  - [x] Redesign the model settings - discussed on May 7 group meeting
  - [x] support self host model
  - [x] remove built-in models
- [ ] P0: Test opencode works well with local models
- [ ] P0: Fix broken legacy agent mode
  - [ ] Can we only support basic chat - not now but eventually yes
- [ ] P0: Auto-save chat history controls
- [ ] P0: Support image context
- [ ] P1: [BUG] Check active note path. Sometimes the agent will start from a path that does not exist
- [ ] P1: MCP
  - Basic functionality is ready
  - [ ] P1: Surface externally-managed MCP servers (claude.ai remote, plugin-provided) — see [MCP_EXTERNALLY_MANAGED_SERVERS.md](./MCP_EXTERNALLY_MANAGED_SERVERS.md)
  - [ ] P1: Support oauth for MCP servers (the one example that I tested didn't work)
  - [ ] P1: Support setting MCP by copy pasting JSON blobs
- [ ] P1: Content type support (image, audio) - https://agentclientprotocol.com/protocol/content
- [ ] P1: Edit diff UI - https://agentclientprotocol.com/protocol/tool-calls#diffs
  - The edit diff should be based on well rendered markdown, not raw markdown file. For example, table is impossible to understand the diff with the raw format
- [ ] P1: Thoroughly test opencode, codex, and claude code with different test cases
  - [ ] Create sample vaults for test cases.
- [ ] P1: Fix session title for claude code agent
- [ ] P1: Agent upgrade detection and helper UI in settings
- [ ] P1: Forward web-source context to the agent
  - The agent should be able to access the content of the rendered tab
  - Right-click "Add to Copilot context" excerpts from web tabs and the
    "include active web tab" toggle currently surface a Notice and are
    dropped before the prompt is built. Wire them into the
    `<copilot-context>` envelope (e.g. a `Web excerpts:` section with
    `title (url): content`) so the agent can actually read them.
- [ ] P1: Move PDF parsing into an agent tool
  - Inline PDF parsing during send can take too long and blocks the user
    before the agent starts. Keep PDF attachments as vault paths for the
    built-in Read tool for now, then expose Copilot PDF parsing as an
    explicit tool the agent can call when it needs extracted PDF text.
- [ ] P1: Token counter
  - To know how many context is left in the current session
  - Nice-to-have: Cost estimate
- [ ] P1: Integrate copilot plus tool calls (convert them to skills)
  - [ ] vault search (make it work with Miyo)
    - may want to rename
    - challenge - how to enable it in an agent
    - challenge - agentic search often is better than RAG, how does the agent know when to trigger it
    - we don't need index-free search
  - [ ] web search (paid feature only)
  - [ ] ~~edit~~
  - [ ] youtube transcription (paid feature only)
  - [ ] obsidian CLI
- [ ] P1: Opencode plan mode fine-tuning
- [ ] P1: compaction
  - [ ] manual trigger
  - [ ] configure when to auto compact
- [ ] P1: Project mode
- [ ] P2: Support subscriptions that work with opencode (kimi code)
- [ ] P2: Claude vscode plugin add comment to plan capability
  - It makes iterating on plan a lot easier
- [x] P2: [UX] Make mode more obvious
  - idea: consider change the chat border color for different modes
- [ ] P2: [UX] fix the brief moment of "Read Read" tool call message
- [ ] P2: Edit previous user message
- [ ] P2: New agent command (/new, /usage)
- [ ] P2: Claude code / Codex authentication
- [ ] P2: Steering conversation (instead of queue)
- [ ] P2: Rollback everything to the state of previous message
- [ ] P3: Rerun agent response
- [ ] P3: Agent todo list
  - [ ] make sure in case it renders, it won't be buggy
- [x] P1: Queue messages
- [x] P1: Only include the provided models
  - hide openrouter models behind a modal selector
- [x] P2: [UX] Thought for x second shows 0 second
- [x] P2: Subagent nested tool calls
- [x] P2: Keyboard shortcut
- [x] P1: Model, effort, and mode is not persisted across sessions
- [x] P2: Rebuild agent session tabs and right click context menu
- [x] P2: Add agent brand indicator in chat
  - so user can know which agent harness they are interacting with
- [x] P2: Rebrand chat send button
  - Make it a send icon to save space and get rid of "chat" label which no longer applies
- [x] P1: Merge copilot models with opencode models
- [x] P1: Agent effort selector
- [x] P1: Codex support
- [x] P1: Cancel chat
- [x] P1: Clean up opencode model list (maybe it's related to the "effort" feature)
- [x] P1: Clicking new chat should reset the tab label
- [x] P2: Agent survey (asking for user input)
  - ~~Not possible with ACP, need more digging~~ now possible after migrating to agent SDK
  - Need to convert the UI to inline card in chat
- [x] P1: Agent message is not rendered in the correct order with the tool calls
- [x] P1: Plan mode preview display
- [x] P1: Support note context input
  - [[note]], the "+ Note" picker, "include active note", and right-click
    "Add to Copilot context" now forward vault-relative paths / inlined
    excerpts in a `<copilot-context>` envelope so the agent's Read tool
    can fetch them via `VaultClient.readTextFile`.
- [x] P1: Agent mode selector (yolo, plan, safe) - https://agentclientprotocol.com/protocol/session-config-options
  - [x] P1: Basic functionality is added but doesn't work well yet. Need thorough test.
