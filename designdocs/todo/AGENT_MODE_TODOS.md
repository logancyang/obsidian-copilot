# ACP Agent Mode TODOs

- P0: Chat history
  - [x] Load chat history from agents
  - [x] Save chat history to notes
- [ ] P1: Create sample vaults for test cases.
- [ ] P1: Provide copilot specific system prompt
- [x] P1: Queue messages
- [ ] P1: MCP
  - Basic functionality is ready
  - [ ] P1: Surface externally-managed MCP servers (claude.ai remote, plugin-provided) — see [MCP_EXTERNALLY_MANAGED_SERVERS.md](./MCP_EXTERNALLY_MANAGED_SERVERS.md)
  - [ ] P1: Support oauth for MCP servers (the one example that I tested didn't work)
- [ ] P1: Skills
- [ ] P1: Permission UI
- [ ] P1: Edit diff UI - https://agentclientprotocol.com/protocol/tool-calls#diffs
- [ ] P1: Agent mode selector (yolo, plan, safe) - https://agentclientprotocol.com/protocol/session-config-options
  - Basic functionality is added but doesn't work well yet. Need thorough test.
- [ ] P1: Merge copilot models with opencode models
  - How to design the settings to configure this?
- [x] P1: Agent effort selector
- [ ] P1: How to support custom command and quick ask?
- [ ] P1: Content type support (image, audio) - https://agentclientprotocol.com/protocol/content
- [ ] P1: Better agent settings
  - prompt user to download opencode or auto detect path
  - make agent mode toggle more obvious
  - make agent mode the default for new users
  - Control which models are available in which agent
    - Add a settings control to configure what agent models are available in the model selector
- [x] P1: Codex support
- [x] P1: Cancel chat
- [ ] P1: Test bash tool call, shall they work?
- [ ] P1: Claude ACP seems to switch between 1M and 200K model randomly
- [x] P1: Clean up opencode model list (maybe it's related to the "effort" feature)
- [x] P1: Clicking new chat should reset the tab label
- [ ] P1: Agent survey (asking for user input)
  - Not possible with ACP, need more digging
- [ ] P1: Agent message is not rendered in the correct order with the tool calls
- [x] P1: Plan mode preview display
- [x] P1: Support note context input
  - [[note]], the "+ Note" picker, "include active note", and right-click
    "Add to Copilot context" now forward vault-relative paths / inlined
    excerpts in a `<copilot-context>` envelope so the agent's Read tool
    can fetch them via `VaultClient.readTextFile`.
- [ ] P1: Model, effort, and mode is not persisted across sessions
- [ ] P1: Detect legacy ACP binaries
  - Some features may not work if using legacy binaries
- [ ] P1: Agent update management
  - what if the ACP package changes
  - how to update ACP packages?
  - how to update downloaded binary?
- [ ] P2: Claude vscode plugin add comment to plan capability
  - It makes iterating on plan a lot easier
- [x] P2: Rebrand chat send button
  - Make it a send icon to save space and get rid of "chat" label which no longer applies
- [ ] P2: Forward web-source context to the agent
  - Right-click "Add to Copilot context" excerpts from web tabs and the
    "include active web tab" toggle currently surface a Notice and are
    dropped before the prompt is built. Wire them into the
    `<copilot-context>` envelope (e.g. a `Web excerpts:` section with
    `title (url): content`) so the agent can actually read them.
- [ ] P2: Token counter
- [ ] P2: Subagent nested tool calls
- [ ] P2: Better agent messages
- [ ] P2: Edit previous user message
- [ ] P2: Integrate copilot plus tool calls
- [ ] P2: Keyboard shortcut
- [ ] P2: New agent command (/new, /usage)
- [ ] P2: Claude code authentication
- [ ] P2: Auto-save chat history controls
- [ ] P2: Slash command support. Revamp current slash command to function like skills.
- [ ] P3: Rerun agent response
- [ ] P3: Agent todo list
