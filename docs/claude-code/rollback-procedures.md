# Claude Code Integration - Rollback Procedures

## Overview

This document provides component-specific rollback procedures for the Claude Code integration. Each component has defined rollback triggers, procedures, and validation steps to ensure system integrity.

## Rollback Triggers

### Automatic Rollback Triggers

- **Error Rate > 10%** - More than 10% of requests failing
- **Response Latency > 5s** - Average response time exceeds threshold
- **Process Crash Rate > 3** - CLI process crashes repeatedly
- **Memory Usage > 500MB** - Integration consuming excessive memory
- **User Reports > 5** - Multiple users reporting issues

### Manual Rollback Triggers

- Critical security vulnerability discovered
- Data corruption detected
- Incompatible Claude CLI update
- Performance degradation in existing providers
- User request for rollback

## Component-Level Rollback Procedures

### 1. ChatClaudeCode Provider Class

#### Rollback Trigger Conditions

- Provider initialization fails repeatedly
- Memory leaks detected in provider
- Incompatible with LangChain update

#### Rollback Procedure

```typescript
// Step 1: Disable provider in settings
settings.claudeCodeEnabled = false;
await saveSettings(settings);

// Step 2: Remove from active providers
delete CHAT_PROVIDER_CONSTRUCTORS[ChatModelProviders.CLAUDE_CODE];

// Step 3: Clear provider from UI
updateProviderDropdown(removeProvider("claude-code"));

// Step 4: Notify users
new Notice("Claude Code provider disabled due to errors. Falling back to cloud providers.");
```

#### Validation Steps

1. Verify provider no longer appears in dropdown
2. Confirm existing providers still function
3. Check no residual Claude processes running
4. Validate settings saved correctly

#### Recovery Time: **< 1 minute**

---

### 2. ClaudeCliInterface Process Management

#### Rollback Trigger Conditions

- Process spawning fails on specific platform
- Security vulnerability in process handling
- Resource exhaustion from zombie processes

#### Rollback Procedure

```bash
# Step 1: Kill all Claude processes
pkill -f claude  # macOS/Linux
taskkill /F /IM claude.exe  # Windows

# Step 2: Disable process spawning
export OBSIDIAN_DISABLE_CLAUDE_SPAWN=1

# Step 3: Clear process pool
ClaudeCliInterface.clearProcessPool();

# Step 4: Switch to fallback mode
ClaudeCliInterface.useFallbackMode = true;
```

#### Validation Steps

1. Verify no Claude processes in system monitor
2. Check memory usage returns to baseline
3. Confirm fallback provider activates
4. Test chat functionality with cloud provider

#### Recovery Time: **< 2 minutes**

---

### 3. ClaudeStreamParser

#### Rollback Trigger Conditions

- Stream parsing causing UI freezes
- Malformed responses corrupting chat
- Memory leak in stream buffers

#### Rollback Procedure

```typescript
// Step 1: Disable streaming mode
class ChatClaudeCode {
  constructor(config) {
    this.streamingEnabled = false; // Force disable
  }

  // Step 2: Use synchronous responses only
  async _streamResponseChunks() {
    // Redirect to non-streaming method
    const response = await this._call(...arguments);
    yield new ChatGenerationChunk({ content: response });
  }
}

// Step 3: Clear stream buffers
ClaudeStreamParser.clearAllBuffers();

// Step 4: Notify user
new Notice("Streaming disabled. Using standard response mode.");
```

#### Validation Steps

1. Confirm responses appear all at once
2. Verify no memory accumulation
3. Check UI responsiveness restored
4. Test with long responses

#### Recovery Time: **< 30 seconds**

---

### 4. ClaudeSessionManager

#### Rollback Trigger Conditions

- Session corruption causing errors
- Memory leak from session storage
- Context confusion between conversations

#### Rollback Procedure

```typescript
// Step 1: Clear all sessions
ClaudeSessionManager.clearAllSessions();
localStorage.removeItem("claude_sessions");

// Step 2: Disable session persistence
settings.claudeSessionMode = "new";
settings.claudeSessionPersistence = false;

// Step 3: Reset to stateless mode
ClaudeSessionManager.useStatelessMode = true;

// Step 4: Notify users
new Notice("Session management reset. Each message starts fresh context.");
```

#### Validation Steps

1. Verify localStorage cleared
2. Confirm each chat starts fresh
3. Check memory usage stable
4. Test context not bleeding between chats

#### Recovery Time: **< 1 minute**

---

### 5. Settings UI Components

#### Rollback Trigger Conditions

- Settings UI crashes Obsidian
- Configuration corruption
- UI elements not rendering

#### Rollback Procedure

```typescript
// Step 1: Hide Claude Code settings tab
const settingsTab = document.querySelector(".claude-code-settings");
if (settingsTab) settingsTab.style.display = "none";

// Step 2: Reset to default configuration
const defaultConfig = {
  claudeCodeEnabled: false,
  claudeCliPath: "",
  claudeModel: "claude-3-sonnet",
  claudeSessionMode: "new",
};
Object.assign(settings, defaultConfig);

// Step 3: Save clean configuration
await plugin.saveSettings();

// Step 4: Reload settings UI
plugin.settingTab.display();
```

#### Validation Steps

1. Verify settings UI loads without errors
2. Confirm other provider settings intact
3. Check configuration file valid JSON
4. Test settings changes save correctly

#### Recovery Time: **< 2 minutes**

---

### 6. Auto-Detection System

#### Rollback Trigger Conditions

- Detection causing startup delays > 10s
- False positive detections
- Platform-specific detection failures

#### Rollback Procedure

```bash
# Step 1: Disable auto-detection
settings.claudeAutoDetect = false;

# Step 2: Clear detection cache
localStorage.removeItem('claude_detection_cache');

# Step 3: Require manual configuration
settings.claudeRequireManualPath = true;

# Step 4: Document known paths for users
publishKnownPaths({
  mac: '/Applications/Claude.app/Contents/MacOS/claude',
  windows: 'C:\\Program Files\\Claude\\claude.exe',
  linux: '/usr/local/bin/claude'
});
```

#### Validation Steps

1. Verify plugin starts without delay
2. Confirm manual path configuration works
3. Check no background detection running
4. Test with explicit path works

#### Recovery Time: **< 1 minute**

---

## Full Integration Rollback

### Complete Rollback Procedure

When multiple components fail or critical issues arise:

#### Phase 1: Immediate Mitigation (< 2 minutes)

```bash
# 1. Disable Claude Code globally
git checkout main -- src/constants.ts  # Remove CLAUDE_CODE enum

# 2. Kill all Claude processes
pkill -f claude || taskkill /F /IM claude.exe

# 3. Clear all Claude data
rm -rf ~/.config/obsidian-copilot/claude/
localStorage.clear();  # In Obsidian console

# 4. Restart Obsidian
```

#### Phase 2: Clean Rollback (< 5 minutes)

```bash
# 1. Revert to previous version
git checkout tags/v3.0.0  # Or last stable version

# 2. Rebuild without Claude Code
npm run build

# 3. Reinstall plugin
cp -r dist/* ~/.obsidian/plugins/obsidian-copilot/

# 4. Restart Obsidian
```

#### Phase 3: User Communication (< 10 minutes)

1. Post rollback notice in plugin settings
2. Update GitHub issues with rollback notice
3. Notify Discord community
4. Provide cloud provider setup guide

### Validation Checklist

After any rollback:

- [ ] All existing providers functional
- [ ] No Claude processes running
- [ ] Memory usage normal
- [ ] Settings UI accessible
- [ ] Chat functionality restored
- [ ] No error messages in console
- [ ] User data intact
- [ ] Performance acceptable

## Monitoring & Alerts

### Health Checks

```typescript
// Automated health monitoring
class ClaudeHealthMonitor {
  async checkHealth() {
    const metrics = {
      errorRate: this.getErrorRate(),
      avgLatency: this.getAverageLatency(),
      processCount: this.getProcessCount(),
      memoryUsage: this.getMemoryUsage(),
    };

    if (this.shouldTriggerRollback(metrics)) {
      await this.initiateRollback();
    }
  }

  shouldTriggerRollback(metrics) {
    return (
      metrics.errorRate > 0.1 ||
      metrics.avgLatency > 5000 ||
      metrics.processCount > 3 ||
      metrics.memoryUsage > 500_000_000
    );
  }
}
```

### Alert Thresholds

| Metric          | Warning | Critical | Auto-Rollback |
| --------------- | ------- | -------- | ------------- |
| Error Rate      | 5%      | 10%      | 15%           |
| Latency         | 3s      | 5s       | 10s           |
| Memory          | 300MB   | 500MB    | 1GB           |
| Process Crashes | 1/hour  | 3/hour   | 5/hour        |

## Recovery Procedures

### After Successful Rollback

1. **Root Cause Analysis**

   - Collect error logs
   - Analyze failure patterns
   - Identify affected components
   - Document lessons learned

2. **Fix Implementation**

   - Create hotfix branch
   - Implement corrections
   - Add regression tests
   - Update monitoring

3. **Staged Re-deployment**
   - Deploy to beta users first
   - Monitor for 24 hours
   - Gradually increase rollout
   - Full deployment after validation

### Communication Templates

#### User Notification (In-App)

```
Claude Code Integration Temporarily Disabled

We've detected an issue with the Claude Code integration and have temporarily disabled it to maintain stability. Your chats will automatically use your configured cloud provider.

No action needed on your part. We'll notify you when the issue is resolved.

For updates: github.com/logancyang/obsidian-copilot/issues
```

#### GitHub Issue Template

```markdown
## Claude Code Integration - Temporary Rollback

**Status:** Rolled back
**Affected versions:** v3.1.0
**Rollback time:** [timestamp]

### Issue

[Brief description of the issue that triggered rollback]

### Impact

- Claude Code provider temporarily unavailable
- Automatic fallback to cloud providers active
- No data loss or corruption

### Resolution Timeline

- Root cause analysis: In progress
- Fix development: [ETA]
- Testing: [ETA]
- Re-deployment: [ETA]

### Workaround

Use any configured cloud provider (OpenAI, Anthropic, etc.) in the meantime.

We apologize for the inconvenience.
```

## Rollback Decision Matrix

| Severity | User Impact | Rollback Type  | Decision Time | Authority   |
| -------- | ----------- | -------------- | ------------- | ----------- |
| Critical | All users   | Immediate Full | < 5 min       | Automatic   |
| High     | > 50% users | Component      | < 15 min      | Dev Team    |
| Medium   | > 20% users | Feature Flag   | < 1 hour      | Team Lead   |
| Low      | < 20% users | Gradual        | < 4 hours     | PM Decision |

## Post-Mortem Requirements

After any rollback:

1. **Timeline** - Document exact sequence of events
2. **Impact** - Number of affected users and duration
3. **Root Cause** - Technical explanation of failure
4. **Resolution** - Steps taken to fix
5. **Prevention** - How to prevent recurrence
6. **Lessons** - What we learned

---

_Document Version: 1.0_  
_Last Updated: 2025-08-27_  
_Review Schedule: After each rollback event_
