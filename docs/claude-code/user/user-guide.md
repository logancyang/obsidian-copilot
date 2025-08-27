# Claude Code User Guide

This comprehensive user guide covers all aspects of using the local Claude Code integration in Obsidian Copilot. Whether you're new to Claude Code or an experienced user, this guide will help you make the most of your local AI assistant.

## 🎯 Introduction

The Claude Code integration transforms your Obsidian experience by bringing the power of local AI directly into your note-taking workflow. Unlike remote AI services, Claude Code runs entirely on your machine, ensuring complete privacy and superior performance.

### Key Benefits

- **🔒 Complete Privacy**: Your conversations never leave your device
- **⚡ Superior Speed**: 3-5x faster than remote AI services
- **💪 No Limits**: Use as much as you want without quotas
- **🧰 Rich Tools**: Access to the MCP ecosystem for enhanced capabilities
- **🔄 Seamless Integration**: Works with all existing Copilot features

## 🚀 Getting Started

### First Conversation

After setup, starting your first conversation is simple:

1. **Open Copilot Chat** (Ctrl/Cmd + P → "Copilot: Open Chat")
2. **Verify Claude Code is selected** (look for the model name in the top bar)
3. **Send your first message**:
   ```
   Hello! Can you help me organize my thoughts about machine learning?
   ```
4. **Watch the magic happen** - you should see a response within 1-2 seconds

### Provider Indicator

When Claude Code is active, you'll see these indicators:

- **Model Name**: Shows "claude-3.5-sonnet (Claude Code)" or similar
- **Status Badge**: Green dot indicates healthy connection
- **Performance Badge**: "Local" badge shows it's running locally
- **MCP Badge**: "Tools" badge indicates MCP tools are available

## 💬 Chat Modes

Obsidian Copilot offers multiple chat modes, all of which work seamlessly with Claude Code:

### 1. Chat Mode

**Best for**: Specific note discussions, targeted questions, content creation

**Features with Claude Code**:

- **Context sharing**: Reference specific notes with `[[Note Name]]` syntax
- **Folder context**: Include entire folders with `{folder-name}` syntax
- **Real-time processing**: Get responses as you type (streaming)
- **MCP tool integration**: Automatic tool usage when relevant

**Example conversation**:

```
You: Can you analyze my [[Weekly Review - March 2024]] note and suggest action items?

Claude: I'll analyze your weekly review note. Let me examine the content...

[Uses file reading tool automatically]

Based on your March 2024 weekly review, I found several areas that could benefit from action items:

1. **Project Management**: You mentioned feeling overwhelmed with multiple projects...
2. **Learning Goals**: The Python course you started needs dedicated time blocks...
3. **Health & Wellness**: Your note mentions skipping workouts due to work pressure...

Would you like me to create a structured action plan for any of these areas?
```

### 2. Vault QA Mode

**Best for**: Searching across your entire vault, pattern recognition, knowledge synthesis

**Features with Claude Code**:

- **Instant search**: No need to build embeddings first
- **Semantic understanding**: Finds conceptually related content
- **Cross-reference analysis**: Connects ideas across different notes
- **MCP-powered search**: Uses advanced search tools automatically

**Example conversation**:

```
You: What patterns can you identify in my journaling about productivity over the last year?

Claude: I'll search through your vault for productivity-related journal entries and analyze patterns...

[Automatically uses vault search tools]

After analyzing your productivity journaling patterns, I've identified several key trends:

**Seasonal Patterns**:
- Higher productivity mentioned in fall months (September-November)
- Productivity dips during summer vacation periods
- January shows goal-setting spikes but execution drops by February

**Weekly Patterns**:
- Most productive days: Tuesday-Thursday
- Monday shows "restart anxiety" themes
- Friday entries focus on weekly reflection

**Productivity Strategies Evolution**:
- Early 2024: Time-blocking focused
- Mid-year: Shifted to energy management
- Recent: Integration of mindfulness practices

Would you like me to dive deeper into any of these patterns or suggest optimization strategies based on what's worked for you?
```

### 3. Project Mode

**Best for**: Working within specific contexts, focused research, collaborative projects

**Features with Claude Code**:

- **Scoped context**: AI understands your project boundaries
- **Tool integration**: MCP tools work within project scope
- **Persistent memory**: Context maintained across sessions
- **Collaborative features**: Share insights with team members

## 🧰 MCP Tools Integration

One of the most powerful features of the Claude Code integration is access to Model Context Protocol (MCP) tools. These tools extend Claude's capabilities significantly.

### Available Tool Categories

#### 1. Obsidian Integration Tools

- **Vault Search**: Semantic and keyword search across your vault
- **Note Operations**: Create, read, update, and organize notes
- **Graph Analysis**: Understand connections between your notes
- **Tag Management**: Organize and analyze your tagging patterns

#### 2. Web and Research Tools

- **Web Search**: Search the internet for current information
- **Website Scraping**: Extract content from web pages
- **PDF Processing**: Read and analyze PDF documents
- **YouTube Integration**: Process video content and transcripts

#### 3. Development Tools

- **Code Analysis**: Understand and refactor code files
- **Git Operations**: Manage version control workflows
- **Documentation Generation**: Create technical documentation
- **Testing Support**: Generate and run test cases

#### 4. Productivity Tools

- **Task Management**: Create and track action items
- **Calendar Integration**: Schedule and manage appointments
- **Email Processing**: Analyze and respond to communications
- **Document Templates**: Generate structured content

### How MCP Tools Work

MCP tools are **automatically activated** when relevant. You don't need to manually invoke them - Claude Code intelligently determines when to use specific tools based on your request.

**Example - Automatic Tool Usage**:

```
You: Find all my notes about machine learning and create a study guide

Claude: I'll search your vault for machine learning content and create a comprehensive study guide.

[Automatically activates vault search tool]
[Automatically activates note analysis tool]
[Automatically activates content generation tool]

# Machine Learning Study Guide

Based on 23 notes in your vault, here's your personalized study guide:

## Core Concepts (from your notes)
- Neural Networks ([[Deep Learning Basics]])
- Supervised Learning ([[ML Algorithms Overview]])
- Feature Engineering ([[Data Preprocessing Notes]])
...

[Generated complete study guide with references to your actual notes]
```

### Manual Tool Selection

While tools activate automatically, you can also request specific tool usage:

```
You: Use the web search tool to find recent developments in transformer architecture

Claude: I'll search for recent transformer architecture developments using the web search tool.

[Explicitly uses web search tool as requested]

Here are the latest developments in transformer architecture I found:

1. **Mamba Architecture** (January 2024): A new state-space model that...
2. **Mixture of Experts (MoE) Improvements**: Recent optimizations in...
3. **Attention Mechanism Alternatives**: Research into replacing attention...
```

### Tool Configuration

You can configure which MCP tools are available:

1. **Open Settings** → Community Plugins → Copilot → Model Settings
2. **Select your Claude Code model**
3. **Click "Configure MCP Tools"**
4. **Enable/disable specific tool categories**:
   - ✅ Vault Operations (recommended)
   - ✅ Web Search (recommended)
   - ✅ File Operations (recommended)
   - ⚠️ System Operations (advanced users only)
   - ⚠️ Network Operations (advanced users only)

## 🎨 Advanced Features

### Context Management

Claude Code excels at maintaining context across long conversations:

#### Conversation Memory

- **Persistent context**: Remembers the entire conversation
- **Cross-session memory**: Can reference previous sessions (if enabled)
- **Context prioritization**: Focuses on most relevant information
- **Memory optimization**: Efficiently manages large contexts

#### Context Control

You can control what context Claude Code has access to:

**Include specific notes**:

```
With context from [[Project Plan]] and [[Meeting Notes]], help me create a status update.
```

**Include folders**:

```
Considering all notes in {project-alpha}, what are our biggest risks?
```

**Include selected text**:

1. Select text in any note
2. Right-click → "Add to Copilot Context"
3. Ask questions about the selected content

### Streaming Responses

Claude Code supports real-time streaming, showing responses as they're generated:

**Benefits**:

- **Immediate feedback**: See responses start immediately
- **Better UX**: No waiting for complete responses
- **Interruptible**: Can stop generation if needed
- **Progress indication**: See how much content is being generated

**Controlling streaming**:

- **Enable**: Settings → Model Settings → Enable Streaming ✅
- **Disable**: Turn off for complete responses only
- **Interrupt**: Press Escape or click Stop button

### Response Formatting

Claude Code supports rich response formatting:

#### Markdown Support

- **Headers**: # ## ### for structure
- **Lists**: Bullets and numbered lists
- **Code blocks**: Syntax-highlighted code
- **Links**: Internal `[[links]]` and external links
- **Tables**: Structured data presentation
- **Emphasis**: **bold**, _italic_, `code`

#### Interactive Elements

- **Collapsible sections**: For long responses
- **Copy buttons**: One-click copying of code blocks
- **Note links**: Clickable links to your vault notes
- **Action buttons**: Quick actions like "Create Note" or "Save to File"

### Batch Operations

Claude Code can efficiently handle multiple operations:

#### Multiple Note Analysis

```
Analyze all notes tagged with #meeting and create a comprehensive summary of action items and decisions.
```

#### Bulk Content Generation

```
Create weekly review templates for each project folder in my vault.
```

#### Mass Organization

```
Review all untagged notes and suggest appropriate tags based on content.
```

## 🔧 Customization Options

### Model Parameters

Fine-tune Claude Code's behavior:

| Parameter             | Range   | Description               | Recommendation      |
| --------------------- | ------- | ------------------------- | ------------------- |
| **Temperature**       | 0.0-1.0 | Creativity vs consistency | 0.7 for general use |
| **Max Tokens**        | 1-8192  | Response length limit     | 4096 for most cases |
| **Top P**             | 0.0-1.0 | Response diversity        | 0.9 (default)       |
| **Frequency Penalty** | 0.0-2.0 | Avoid repetition          | 0.0 (default)       |
| **Presence Penalty**  | 0.0-2.0 | Encourage new topics      | 0.0 (default)       |

### System Prompts

Customize Claude Code's behavior with system prompts:

#### Academic Writing Assistant

```
You are an academic writing assistant. Focus on:
- Clear, precise language
- Proper citation formats
- Logical argument structure
- Evidence-based reasoning
Always ask for clarification when instructions are ambiguous.
```

#### Creative Writing Coach

```
You are a creative writing coach. Help with:
- Character development
- Plot structure
- Dialogue improvement
- Style and voice
Be encouraging while providing constructive feedback.
```

#### Technical Documentation Specialist

```
You are a technical documentation specialist. Prioritize:
- Clear, step-by-step instructions
- Comprehensive examples
- Troubleshooting sections
- User-focused explanations
Assume users have basic technical knowledge unless told otherwise.
```

### Workspace Integration

#### Command Palette Integration

Claude Code commands are available in the command palette:

- **Ctrl/Cmd + P** → "Claude Code: Start Chat"
- **Ctrl/Cmd + P** → "Claude Code: Toggle Streaming"
- **Ctrl/Cmd + P** → "Claude Code: Reset Connection"
- **Ctrl/Cmd + P** → "Claude Code: Show Status"

#### Hotkey Configuration

Set up custom hotkeys for frequent actions:

1. **Settings** → Hotkeys
2. **Search for "Claude Code"**
3. **Assign keys**:
   - Claude Code Chat: `Ctrl/Cmd + Alt + C`
   - New Conversation: `Ctrl/Cmd + Alt + N`
   - Toggle Tools: `Ctrl/Cmd + Alt + T`

#### Context Menu Integration

Right-click menus include Claude Code options:

- **On selected text**: "Explain with Claude Code"
- **On note title**: "Summarize with Claude Code"
- **On folder**: "Analyze folder with Claude Code"

## 📊 Performance Features

### Speed Optimizations

Claude Code is optimized for speed:

**Connection Pooling**:

- Maintains persistent connections
- Reduces connection overhead
- Handles concurrent requests efficiently

**Response Caching**:

- Caches frequent queries
- Reduces redundant processing
- Smart cache invalidation

**Request Batching**:

- Combines related requests
- Reduces network overhead
- Maintains response order

### Resource Management

**Memory Efficiency**:

- Intelligent context trimming
- Garbage collection optimization
- Memory leak prevention

**CPU Optimization**:

- Efficient processing algorithms
- Background task management
- Priority-based scheduling

### Performance Monitoring

Monitor Claude Code performance:

1. **Status Panel**: Shows current performance metrics
2. **Health Checks**: Automatic system health monitoring
3. **Performance Alerts**: Notifications for performance issues
4. **Resource Usage**: Real-time resource consumption

## 🔍 Troubleshooting Common Issues

### Performance Issues

#### Slow Responses

**Symptoms**: Responses take longer than 5 seconds
**Solutions**:

1. Check system resources (RAM, CPU)
2. Restart Claude Code process
3. Clear cache and temporary files
4. Reduce context size
5. Update to latest version

#### Memory Issues

**Symptoms**: High memory usage, system slowdown
**Solutions**:

1. Reduce max tokens setting
2. Clear conversation history
3. Restart Obsidian
4. Check for memory leaks in logs
5. Upgrade system RAM if needed

### Connection Issues

#### Frequent Disconnections

**Symptoms**: "Connection lost" errors, intermittent responses
**Solutions**:

1. Check network stability
2. Increase timeout settings
3. Verify firewall configuration
4. Update network drivers
5. Use wired connection if on WiFi

#### Authentication Failures

**Symptoms**: "Unauthorized" or "Authentication failed" errors
**Solutions**:

1. Verify API key in settings
2. Check Claude Code server status
3. Reset authentication tokens
4. Restart both applications
5. Check user permissions

### Tool Integration Issues

#### Tools Not Working

**Symptoms**: MCP tools not activating, error messages
**Solutions**:

1. Verify MCP tools are enabled in settings
2. Check tool permissions
3. Update MCP server components
4. Clear tool cache
5. Restart with fresh configuration

#### Vault Access Problems

**Symptoms**: Can't read notes, permission denied errors
**Solutions**:

1. Check Obsidian vault permissions
2. Verify Claude Code workspace settings
3. Reset file access permissions
4. Check for conflicting plugins
5. Restart with administrator privileges

## 🎓 Best Practices

### Conversation Design

#### Clear Communication

- **Be specific**: "Summarize my meeting notes from last week" vs "Help me"
- **Provide context**: Reference specific notes, folders, or time periods
- **Set expectations**: Specify desired output format or length
- **Use examples**: Show what you want when instructions are complex

#### Effective Prompting

- **Start broad, then narrow**: Begin with general questions, then dive into specifics
- **Use iterative refinement**: Build on previous responses
- **Leverage tools**: Let Claude Code use its tools rather than trying to provide all context manually
- **Break down complex tasks**: Divide large projects into smaller, manageable pieces

### Workflow Integration

#### Daily Routines

**Morning Planning**:

```
Review my calendar for today and my project notes. Help me prioritize my tasks and identify potential conflicts.
```

**End-of-Day Review**:

```
Based on today's notes and completed tasks, help me prepare tomorrow's focus areas.
```

#### Weekly Workflows

**Weekly Review**:

```
Analyze my notes from this week and identify:
1. Key accomplishments
2. Unfinished items that need attention
3. Patterns or insights I should be aware of
```

**Planning Sessions**:

```
Help me plan next week by analyzing:
- Upcoming deadlines in my project notes
- Recurring commitments in my calendar
- Goal progress from my tracking notes
```

### Knowledge Management

#### Note Organization

- **Use Claude Code to suggest tags**: Let it analyze content and recommend organizational structures
- **Create connection maps**: Ask it to identify relationships between notes
- **Generate summaries**: Create executive summaries of complex topics
- **Build learning paths**: Organize notes into learning sequences

#### Content Creation

- **Collaborative writing**: Use Claude Code as a writing partner, not just a generator
- **Research assistance**: Let it help find gaps in your knowledge or research
- **Quality improvement**: Ask for feedback on structure, clarity, and completeness
- **Template creation**: Generate reusable templates for common note types

### Security Practices

#### Data Privacy

- **Local processing**: Remember that Claude Code runs locally - your data stays private
- **Sensitive information**: Still be cautious with highly sensitive data
- **Regular backups**: Maintain backups of important conversations and configurations
- **Access control**: Limit who has access to your Claude Code instance

#### System Security

- **Keep updated**: Regularly update Claude Code and Obsidian Copilot
- **Network security**: Use firewalls and secure network connections
- **User permissions**: Run with appropriate (not administrator) privileges
- **Log monitoring**: Regularly check logs for unusual activity

## 🚀 Advanced Workflows

### Research Projects

```
I'm starting research on [topic]. Help me:
1. Find related notes in my vault
2. Identify knowledge gaps
3. Create a research plan
4. Generate question lists for investigation
5. Set up a note structure for organizing findings
```

### Content Creation

```
Help me write a comprehensive guide on [topic] by:
1. Analyzing my existing notes on the subject
2. Identifying the target audience needs
3. Creating an outline
4. Drafting sections with my knowledge as the foundation
5. Adding examples from my experience
```

### Learning Projects

```
I want to learn [skill/subject]. Using my vault:
1. Assess my current knowledge level
2. Create a personalized learning path
3. Identify resources I already have
4. Suggest practice projects
5. Set up tracking mechanisms
```

### Decision Making

```
I need to make a decision about [situation]. Help me:
1. Identify all relevant information in my notes
2. List pros and cons based on my experiences
3. Consider potential outcomes
4. Apply decision-making frameworks I've learned
5. Create an action plan
```

---

_This guide covers the core features and workflows. For specific technical issues, see the [Troubleshooting Guide](troubleshooting.md), and for advanced configuration options, check the [Technical Documentation](../technical/)._
