# Claude Code CLI Setup Guide for Obsidian Copilot

## Prerequisites

Before setting up Claude Code integration with Obsidian Copilot, ensure you have:

- ✅ Active Claude Code subscription ($20/month from Anthropic)
- ✅ Obsidian Copilot plugin installed (version 3.0.0 or later)
- ✅ Administrator/sudo access on your computer (for installation)
- ✅ 8GB+ RAM available for Claude Code to run efficiently

## Step 1: Install Claude Code CLI

### macOS Installation

#### Option A: Download from Claude.ai (Recommended)

1. Visit [https://claude.ai/download](https://claude.ai/download)
2. Click "Download for Mac"
3. Open the downloaded `.dmg` file
4. Drag Claude to your Applications folder
5. Open Terminal and verify installation:
   ```bash
   claude --version
   ```

#### Option B: Install via Homebrew

```bash
# Install Claude Code
brew install --cask claude

# Verify installation
claude --version
```

### Windows Installation

1. Visit [https://claude.ai/download](https://claude.ai/download)
2. Click "Download for Windows"
3. Run the installer (`.exe` file)
4. Follow the installation wizard
5. **Important:** During installation, ensure "Add to PATH" is checked
6. Open Command Prompt or PowerShell and verify:
   ```cmd
   claude --version
   ```

#### Windows PATH Troubleshooting

If `claude` command is not found:

1. Open System Properties → Advanced → Environment Variables
2. Under System Variables, find and edit "Path"
3. Add Claude installation directory (typically `C:\Program Files\Claude\bin`)
4. Restart Command Prompt and try again

### Linux Installation

#### Ubuntu/Debian

```bash
# Download the .deb package
wget https://claude.ai/download/claude-latest.deb

# Install the package
sudo dpkg -i claude-latest.deb

# Fix any dependency issues
sudo apt-get install -f

# Verify installation
claude --version
```

#### Other Linux Distributions

```bash
# Download the AppImage
wget https://claude.ai/download/claude-latest.AppImage

# Make it executable
chmod +x claude-latest.AppImage

# Move to a directory in PATH
sudo mv claude-latest.AppImage /usr/local/bin/claude

# Verify installation
claude --version
```

## Step 2: Authenticate Claude Code

1. Open Terminal/Command Prompt
2. Run the authentication command:
   ```bash
   claude auth login
   ```
3. A browser window will open for authentication
4. Log in with your Claude.ai account
5. Authorize the CLI application
6. Return to terminal - you should see "Authentication successful!"

### Authentication Troubleshooting

**Issue: Browser doesn't open automatically**

- Copy the URL shown in terminal and paste in your browser manually

**Issue: Authentication fails**

- Ensure you have an active Claude Code subscription
- Try logging out first: `claude auth logout`
- Clear browser cookies for claude.ai and retry

## Step 3: Configure Obsidian Copilot

### Enable Claude Code Provider

1. Open Obsidian Settings (Cmd/Ctrl + ,)
2. Navigate to "Community plugins" → "Obsidian Copilot"
3. Click on "Copilot" settings tab
4. Scroll to "Model Settings" section
5. In the "Chat Model Provider" dropdown, select "Claude Code (Local)"

### Configure Claude Code Settings

1. **Claude CLI Path** (Auto-detection usually works)

   - Leave empty for auto-detection
   - Or manually enter path found via:
     - macOS/Linux: `which claude`
     - Windows: `where claude`

2. **Model Selection**

   - Choose your preferred model:
     - **Claude 3.5 Sonnet** (Recommended - best balance)
     - **Claude 3 Opus** (Most capable, slower)
     - **Claude 3 Haiku** (Fastest, lightweight)

3. **Session Management**

   - **Start new session**: Each chat starts fresh
   - **Continue session**: Maintains context across chats (recommended)

4. **Advanced Settings** (Optional)

   - **Enable Fallback**: Falls back to cloud providers if Claude Code fails
   - **Timeout**: Default 30 seconds (increase for longer responses)
   - **Debug Mode**: Enable for troubleshooting

5. Click "Test Connection" button
6. You should see "✓ Claude Code connected successfully"

## Step 4: Verify Installation

### Quick Test

1. Open a new Obsidian note
2. Open Copilot chat (click Copilot icon in ribbon)
3. Ensure "Claude Code (Local)" is selected in the model dropdown
4. Type a test message: "Hello, are you running locally?"
5. You should receive a response without any network requests

### Performance Check

- First response: Should start within 500ms
- Streaming: Should show tokens appearing smoothly
- No internet: Disable WiFi/Ethernet and verify it still works

## Troubleshooting Common Issues

### Issue: "Claude Code not detected"

**Solution 1:** Manual path configuration

1. Find Claude installation:
   - macOS: `/Applications/Claude.app/Contents/MacOS/claude`
   - Windows: `C:\Program Files\Claude\claude.exe`
   - Linux: `/usr/local/bin/claude`
2. Enter full path in settings
3. Click "Test Connection"

**Solution 2:** Check PATH environment

```bash
# Check if claude is in PATH
echo $PATH | grep -i claude  # macOS/Linux
echo %PATH% | findstr /I claude  # Windows
```

### Issue: "Claude command failed with error"

**Possible causes and solutions:**

1. **Not authenticated:**

   ```bash
   claude auth status  # Check auth status
   claude auth login   # Re-authenticate if needed
   ```

2. **Subscription expired:**

   - Visit [claude.ai/subscription](https://claude.ai/subscription)
   - Verify active Claude Code subscription

3. **Process permissions:**
   - Ensure Obsidian has permission to spawn processes
   - macOS: Check Security & Privacy settings
   - Windows: Run Obsidian as Administrator (once for testing)

### Issue: "Response streaming not working"

1. Check streaming is enabled in settings
2. Try non-streaming mode first (disable streaming)
3. Check Claude CLI version:
   ```bash
   claude --version  # Should be 1.0.0 or later
   ```

### Issue: "Sessions not maintaining context"

1. Ensure "Continue session" is selected in settings
2. Check session hasn't expired (24 hour default)
3. Try clearing sessions:
   ```bash
   claude session clear
   ```

## Advanced Configuration

### Using Multiple Claude Models

You can switch between models on-the-fly:

1. Add multiple Claude Code providers with different models
2. Name them distinctly (e.g., "Claude Sonnet", "Claude Haiku")
3. Switch between them using the model dropdown

### Custom Claude CLI Flags

For power users, you can add custom flags in Advanced Settings:

- `--max-tokens 4000` - Increase response length
- `--temperature 0.7` - Adjust creativity
- `--top-p 0.9` - Fine-tune sampling

### Performance Optimization

1. **Close unused applications** to free RAM for Claude
2. **Use SSD storage** for faster model loading
3. **Disable streaming** if on slower machines
4. **Choose Haiku model** for faster responses

## Security & Privacy

### What stays local:

- ✅ All your conversations
- ✅ Your notes and vault content
- ✅ Claude's responses
- ✅ Session history

### What goes to Anthropic:

- ⚠️ Authentication token (one-time)
- ⚠️ Usage metrics (optional, can be disabled)
- ❌ No conversation content
- ❌ No vault data

### Security Best Practices:

1. Keep Claude Code updated
2. Use session timeout for sensitive work
3. Clear sessions after sensitive conversations:
   ```bash
   claude session clear
   ```
4. Review Obsidian's console for any errors

## Getting Help

### Support Resources

1. **Obsidian Copilot Issues:**

   - GitHub: [github.com/logancyang/obsidian-copilot/issues](https://github.com/logancyang/obsidian-copilot/issues)
   - Discord: Obsidian Copilot channel

2. **Claude Code Issues:**

   - Anthropic Support: [support.anthropic.com](https://support.anthropic.com)
   - Claude Code Status: [status.anthropic.com](https://status.anthropic.com)

3. **Community Help:**
   - Obsidian Forum: [forum.obsidian.md](https://forum.obsidian.md)
   - Reddit: r/ObsidianMD

### Diagnostic Information

When reporting issues, include:

```bash
# System info
claude --version
obsidian --version  # From Obsidian About dialog
node --version

# Test Claude CLI
claude "Test message" --print

# Check authentication
claude auth status

# Session info
claude session list
```

## Frequently Asked Questions

**Q: Will this work offline?**
A: Yes! Once authenticated, Claude Code works completely offline.

**Q: How much disk space does Claude Code use?**
A: Approximately 4-6GB for the models and application.

**Q: Can I use this with multiple vaults?**
A: Yes, each vault can have its own Claude Code configuration.

**Q: Is my data safe?**
A: Yes, all processing happens locally on your machine. No data is sent to any servers.

**Q: Can I use custom models?**
A: Currently limited to official Anthropic models (Opus, Sonnet, Haiku).

**Q: Why is the first response slow?**
A: Initial model loading takes 2-5 seconds. Subsequent responses are much faster.

---

_Last Updated: 2025-08-27_  
_Compatible with: Obsidian Copilot v3.0.0+ and Claude Code v1.0.0+_
