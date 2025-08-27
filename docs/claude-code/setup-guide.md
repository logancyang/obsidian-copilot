# Claude Code Setup Guide

This comprehensive guide will walk you through setting up the local Claude Code integration in Obsidian Copilot. The setup process is designed to be as simple as possible with automatic detection and configuration.

## 🎯 Overview

The Claude Code integration allows you to use your local Claude Code installation as an LLM provider in Obsidian Copilot, giving you:

- **Complete privacy** - All processing happens locally
- **Faster responses** - 3-5x faster than remote providers
- **No rate limits** - Use as much as you want
- **MCP tools access** - Leverage the full MCP ecosystem

## 📋 Prerequisites

Before starting the setup, ensure you have:

### System Requirements

- **Operating System**: macOS, Linux, or Windows
- **Memory**: Minimum 4GB RAM (8GB recommended)
- **Storage**: 100MB additional space for integration
- **Network**: Local network access for inter-process communication

### Software Requirements

- **Obsidian**: Version 1.4.0 or higher
- **Obsidian Copilot Plugin**: Version 3.0.0 or higher
- **Claude Code**: Installed and accessible via command line
- **Node.js**: Version 18.0.0 or higher

### Claude Code Installation

If you don't have Claude Code installed yet:

1. **Install via npm** (recommended):

   ```bash
   npm install -g @anthropic/claude-code
   ```

2. **Verify installation**:

   ```bash
   claude-code --version
   ```

3. **Test Claude Code**:
   ```bash
   claude-code --help
   ```

## 🚀 Quick Setup (Recommended)

The fastest way to get started is with automatic detection:

### Step 1: Start Claude Code

1. Open your terminal
2. Navigate to your working directory
3. Start Claude Code with server mode:
   ```bash
   claude-code --server --port 8080
   ```

### Step 2: Enable Auto-Discovery

1. Open Obsidian
2. Go to **Settings → Community Plugins → Copilot**
3. Navigate to the **Model Settings** tab
4. Look for the notification: _"Claude Code detected on port 8080"_
5. Click **"Configure Automatically"**

### Step 3: Verify Setup

1. In the **Available Models** list, you should see:
   - **claude-3.5-sonnet (Claude Code)** ✅
2. Select this model as your active provider
3. Test with a simple message: "Hello, Claude!"

**🎉 Congratulations! You're now using local Claude Code in Obsidian.**

## ⚙️ Manual Setup

If automatic setup doesn't work, follow these manual steps:

### Step 1: Add Custom Model

1. Open **Obsidian Settings → Community Plugins → Copilot**
2. Go to **Model Settings** tab
3. Click **"Add Custom Model"**
4. Fill in the details:

| Field          | Value                        | Description                    |
| -------------- | ---------------------------- | ------------------------------ |
| **Model Name** | `claude-3.5-sonnet`          | Display name for the model     |
| **Provider**   | `Claude Code`                | Select from dropdown           |
| **Base URL**   | `http://localhost:8080`      | Claude Code server URL         |
| **API Key**    | `default-key`                | Any value (not used for local) |
| **Model**      | `claude-3-5-sonnet-20241022` | Specific model version         |

### Step 2: Configure Advanced Settings

Click **"Advanced Settings"** to configure:

| Setting              | Default | Description                     |
| -------------------- | ------- | ------------------------------- |
| **Max Tokens**       | `4096`  | Maximum response length         |
| **Temperature**      | `0.7`   | Response creativity (0.0-1.0)   |
| **Timeout**          | `30000` | Request timeout in milliseconds |
| **Enable Streaming** | `true`  | Stream responses in real-time   |
| **Enable MCP Tools** | `true`  | Access to MCP tool ecosystem    |

### Step 3: Test Connection

1. Click **"Test Connection"** button
2. Wait for the green ✅ status indicator
3. If successful, click **"Save"**

## 🛠️ Advanced Configuration

### Custom Port Configuration

If you need to use a different port:

1. **Start Claude Code with custom port**:

   ```bash
   claude-code --server --port 3000
   ```

2. **Update Base URL** in Obsidian:
   - Change to `http://localhost:3000`

### Multiple Claude Code Instances

You can run multiple instances for different purposes:

1. **Development instance** (port 8080):

   ```bash
   claude-code --server --port 8080 --workspace ~/dev-projects
   ```

2. **Research instance** (port 8081):

   ```bash
   claude-code --server --port 8081 --workspace ~/research-notes
   ```

3. **Add both models** in Obsidian with different names:
   - `claude-dev` → `http://localhost:8080`
   - `claude-research` → `http://localhost:8081`

### Environment Variables

Set these environment variables for consistent configuration:

```bash
# Claude Code settings
export CLAUDE_CODE_HOST=localhost
export CLAUDE_CODE_PORT=8080
export CLAUDE_CODE_TIMEOUT=30000

# MCP settings
export CLAUDE_CODE_ENABLE_MCP=true
export CLAUDE_CODE_MCP_SERVERS="basic-memory,firecrawl,ref"
```

### SSL/TLS Configuration (Optional)

For enhanced security, configure HTTPS:

1. **Generate certificates**:

   ```bash
   openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes
   ```

2. **Start Claude Code with SSL**:

   ```bash
   claude-code --server --port 8443 --ssl --cert cert.pem --key key.pem
   ```

3. **Update Base URL** to `https://localhost:8443`

## 🔍 Verification Checklist

After setup, verify everything is working:

### ✅ Connection Test

- [ ] Green status indicator in model settings
- [ ] "Test Connection" passes successfully
- [ ] No error messages in Obsidian console

### ✅ Basic Functionality

- [ ] Can send messages and receive responses
- [ ] Streaming works (text appears progressively)
- [ ] Response times are under 2 seconds
- [ ] No connection timeouts

### ✅ MCP Tools (if enabled)

- [ ] Tools appear in chat interface
- [ ] Can execute vault search tool
- [ ] File operations work correctly
- [ ] No permission errors

### ✅ Performance

- [ ] First response arrives quickly (< 1 second)
- [ ] Consistent response times
- [ ] No memory leaks over extended use
- [ ] CPU usage remains reasonable

## 🚨 Troubleshooting

### Common Issues and Solutions

#### "Claude Code not detected"

**Symptoms**: Auto-discovery fails, manual connection fails
**Solutions**:

1. Verify Claude Code is running: `curl http://localhost:8080/health`
2. Check port availability: `netstat -an | grep 8080`
3. Restart Claude Code with verbose logging: `claude-code --server --port 8080 --verbose`
4. Check firewall settings allow local connections

#### "Connection timeout"

**Symptoms**: Requests fail with timeout errors
**Solutions**:

1. Increase timeout in settings (try 60000ms)
2. Check Claude Code server logs for errors
3. Verify system resources (RAM, CPU) are available
4. Restart both Claude Code and Obsidian

#### "Permission denied" errors

**Symptoms**: MCP tools can't access files or vault
**Solutions**:

1. Check Claude Code workspace permissions
2. Verify Obsidian vault permissions
3. Run Claude Code with appropriate user permissions
4. Check file system security settings

#### "Model not available" errors

**Symptoms**: Selected model shows as unavailable
**Solutions**:

1. Verify model name matches exactly
2. Check Claude Code supports the specified model
3. Update to latest Claude Code version
4. Try with default model name: `claude-3-5-sonnet-20241022`

### Advanced Troubleshooting

#### Enable Debug Logging

1. **In Obsidian**:

   - Open Developer Console (Ctrl/Cmd + Shift + I)
   - Look for Claude Code related messages

2. **In Claude Code**:

   ```bash
   claude-code --server --port 8080 --debug --log-level debug
   ```

3. **System logs**:
   - **macOS**: `tail -f /var/log/system.log`
   - **Linux**: `tail -f /var/log/syslog`
   - **Windows**: Check Event Viewer

#### Network Diagnostics

Test network connectivity:

```bash
# Test basic connectivity
curl -v http://localhost:8080/health

# Test chat endpoint
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"test"}]}'

# Test WebSocket (if using WebSocket mode)
wscat -c ws://localhost:8080/ws
```

#### Performance Profiling

Monitor resource usage:

```bash
# CPU and memory usage
top -p $(pgrep claude-code)

# Network connections
netstat -an | grep 8080

# File descriptors
lsof -p $(pgrep claude-code)
```

## 🔄 Next Steps

After successful setup:

1. **Read the [User Guide](user/user-guide.md)** to learn all features
2. **Explore [Common Workflows](user/workflows.md)** for best practices
3. **Check out [MCP Tools](knowledge-base/mcp-tools.md)** for advanced capabilities
4. **Review [Performance Optimization](technical/performance.md)** for tuning
5. **Set up [Monitoring](technical/monitoring.md)** for production use

## 📞 Getting Help

If you encounter issues not covered here:

1. **Check the [Troubleshooting Guide](user/troubleshooting.md)**
2. **Review [FAQ](user/faq.md)** for common questions
3. **Search [GitHub Issues](https://github.com/logancyang/obsidian-copilot/issues)**
4. **Join our [Discord Community](https://discord.gg/obsidian-copilot)**
5. **Open a [New Issue](https://github.com/logancyang/obsidian-copilot/issues/new)**

---

_Need help? The [troubleshooting guide](user/troubleshooting.md) covers common issues, or join our [Discord community](https://discord.gg/obsidian-copilot) for live support._
