# Claude Code Integration - User Guide

## Overview

The Claude Code integration for Obsidian Copilot allows you to use Claude AI locally through the Claude CLI instead of relying on cloud APIs. This provides:

- **Privacy**: Your data stays on your machine
- **Speed**: No network latency for AI responses
- **Offline capability**: Works without internet (after initial setup)
- **Cost savings**: No API usage charges

## Prerequisites

### 1. Install Claude Code CLI

You need to have Claude Code installed on your system. Visit [Claude Code](https://claude.ai/code) to download and install the CLI for your platform.

#### Installation by Platform

**macOS:**

```bash
# Using Homebrew (recommended)
brew install claude

# Or download from claude.ai/code
```

**Windows:**

```powershell
# Download installer from claude.ai/code
# Or use winget:
winget install Anthropic.Claude
```

**Linux:**

```bash
# Download from claude.ai/code
# Extract and add to PATH
tar -xzf claude-linux.tar.gz
sudo mv claude /usr/local/bin/
```

### 2. Verify Installation

After installation, verify Claude CLI is working:

```bash
claude --version
```

You should see output like: `1.0.93 (Claude Code)`

## Configuration

### Enable Claude Code in Obsidian Copilot

1. Open Obsidian Settings (⚙️)
2. Navigate to **Copilot** → **Settings**
3. Find **Claude Code (Local)** section
4. Toggle **Enable Claude Code** to ON

### Configure Claude CLI Path

#### Option 1: Auto-Detection (Recommended)

1. Click the **Auto-detect** button
2. The plugin will search common installation locations
3. If found, the path will be filled automatically
4. Click **Validate** to confirm it's working

#### Option 2: Manual Configuration

1. Enter the full path to your Claude CLI executable
   - macOS/Linux: `/usr/local/bin/claude` or `/opt/homebrew/bin/claude`
   - Windows: `C:\Program Files\Claude\claude.exe`
2. Click **Validate** to test the connection

### Select Model

Choose your preferred Claude model:

- **Claude 3.5 Sonnet** - Most capable, best for complex tasks
- **Claude 3 Opus** - Largest context window, best for long documents
- **Claude 3 Haiku** - Fastest responses, best for quick tasks

### Session Management

Configure how Claude Code manages conversation context:

- **Start new session for each chat** - Each conversation is independent
- **Continue previous session** - Maintain context across conversations

## Usage

### Starting a Chat

1. Open the Copilot chat view (use command palette or sidebar)
2. Ensure **Claude Code (Local)** is selected as your model
3. Type your message and press Enter
4. Claude will process your request locally

### Features

- **Streaming responses**: See Claude's response as it's generated
- **Code assistance**: Get help with coding tasks
- **Document analysis**: Analyze and summarize documents
- **Creative writing**: Generate content and ideas
- **No token limits**: Use as much as you want without API costs

## Advanced Options

### Enable Fallback Mode

If Claude Code is unavailable, automatically fall back to cloud API:

1. In settings, expand **Advanced Options**
2. Toggle **Enable Fallback Mode**
3. Ensure you have cloud API credentials configured

### Adjust Response Timeout

Customize how long to wait for Claude responses:

1. In Advanced Options, find **Response Timeout**
2. Enter timeout in seconds (10-300)
3. Default is 30 seconds

## Troubleshooting

### Claude Code Not Detected

If auto-detection fails:

1. Verify Claude CLI is installed: `claude --version`
2. Check Claude is in your PATH: `which claude` (macOS/Linux) or `where claude` (Windows)
3. Try manual path configuration
4. Restart Obsidian after installation

### Validation Fails

If path validation fails:

1. Check the path is correct and Claude CLI exists there
2. Ensure you have execution permissions
3. Try running `claude --version` in terminal to verify it works
4. Check for any security software blocking execution

### No Response from Claude

If Claude doesn't respond:

1. Check Claude CLI is running: `claude --version`
2. Increase timeout in Advanced Options
3. Check system resources (CPU/Memory)
4. Try restarting Claude service
5. Enable fallback mode as a temporary workaround

### Performance Issues

For better performance:

1. Use **Claude 3 Haiku** for faster responses
2. Start new sessions to avoid large context
3. Close other applications using Claude
4. Check disk space for Claude's local cache

## Tips and Best Practices

### Optimize for Speed

- Use Haiku model for quick tasks
- Start new sessions when context isn't needed
- Keep prompts concise and specific

### Maximize Privacy

- Disable fallback mode for complete local operation
- Review Claude's local data storage settings
- Use project-specific sessions for isolation

### Context Management

- Use "Continue session" for related tasks
- Start new sessions for unrelated topics
- Clear context periodically for best performance

## Support

### Getting Help

- **Documentation**: Check this guide and FAQ
- **GitHub Issues**: Report bugs at [obsidian-copilot/issues](https://github.com/logancyang/obsidian-copilot/issues)
- **Community**: Join Obsidian Discord #copilot channel

### Providing Feedback

Help improve Claude Code integration:

1. Report issues with detailed steps to reproduce
2. Suggest features via GitHub issues
3. Share your use cases and workflows
4. Contribute to documentation

## FAQ

**Q: Does Claude Code work offline?**
A: Yes, after initial setup, Claude Code works completely offline.

**Q: Is my data sent to Anthropic?**
A: No, when using Claude Code (Local), all processing happens on your machine.

**Q: Can I use both local and cloud Claude?**
A: Yes, enable fallback mode or manually switch between providers.

**Q: What are the system requirements?**
A: Claude Code requires:

- 8GB RAM minimum (16GB recommended)
- 2GB free disk space
- macOS 11+, Windows 10+, or Linux (Ubuntu 20.04+)

**Q: How do I update Claude CLI?**
A: Update through your package manager or download the latest version from claude.ai/code

---

_Last updated: 2025-08-27_
