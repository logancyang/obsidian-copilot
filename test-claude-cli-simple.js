/**
 * Simple Claude CLI Validation Test (JavaScript)
 *
 * Validates that our TypeScript implementation approach will work
 * by testing the core functionality in plain JavaScript.
 */

const { spawn } = require("child_process"); // eslint-disable-line @typescript-eslint/no-require-imports

// Test configuration
const CLAUDE_CLI_PATH = "claude";
const platform = process.platform;

console.log("🔍 Claude CLI Validation Test");
console.log(`Platform: ${platform}`);
console.log("=".repeat(50));

// Test 1: Basic Version Check
async function testBasicVersion() {
  console.log("🧪 Test 1: Basic Version Check");

  return new Promise((resolve) => {
    const spawnOptions = {
      env: process.env,
      cwd: process.cwd(),
      shell: platform === "win32",
    };

    const claude = spawn(CLAUDE_CLI_PATH, ["--version"], spawnOptions);

    let stdout = "";
    let stderr = "";

    claude.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    claude.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    claude.on("close", (code) => {
      const success = code === 0;
      const version = success ? stdout.trim() : null;

      if (success) {
        console.log(`   ✅ Success - Version: ${version}`);
      } else {
        console.log(`   ❌ Failed - Exit code: ${code}, Error: ${stderr}`);
      }

      resolve({
        success,
        version,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code,
      });
    });

    claude.on("error", (err) => {
      console.log(`   ❌ Spawn Error: ${err.message}`);
      resolve({
        success: false,
        error: err.message,
        stdout: "",
        stderr: "",
        exitCode: null,
      });
    });
  });
}

// Test 2: Process Cleanup
async function testProcessCleanup() {
  console.log("🧪 Test 2: Process Cleanup");

  return new Promise((resolve) => {
    const claude = spawn(CLAUDE_CLI_PATH, ["--version"]);

    let processEnded = false;
    claude.on("close", () => {
      processEnded = true;
      console.log("   ✅ Process cleanup successful");
      resolve({ success: true });
    });

    claude.on("error", (err) => {
      processEnded = true;
      console.log(`   ❌ Process error: ${err.message}`);
      resolve({ success: false, error: err.message });
    });

    // Timeout check
    setTimeout(() => {
      if (!processEnded) {
        claude.kill("SIGTERM");
        console.log("   ⚠️ Process had to be forcefully terminated");
        resolve({ success: false, error: "Process hanging" });
      }
    }, 5000);
  });
}

// Test 3: Error Handling with Invalid Command
async function testErrorHandling() {
  console.log("🧪 Test 3: Error Handling");

  return new Promise((resolve) => {
    const claude = spawn("nonexistent-claude-cli", ["--version"]);

    claude.on("error", (err) => {
      console.log("   ✅ Error handling works - caught expected error");
      resolve({ success: true, expectedError: err.message });
    });

    claude.on("close", (code) => {
      if (code !== 0) {
        console.log("   ✅ Error handling works - non-zero exit code");
        resolve({ success: true, exitCode: code });
      } else {
        console.log("   ❌ Error handling failed - should have failed");
        resolve({ success: false });
      }
    });
  });
}

// Test 4: Platform-Specific Behavior
async function testPlatformBehavior() {
  console.log("🧪 Test 4: Platform-Specific Behavior");

  const spawnOptions = {
    env: process.env,
    cwd: process.cwd(),
    shell: platform === "win32",
  };

  console.log(`   Platform: ${platform}`);
  console.log(`   Shell option: ${spawnOptions.shell}`);
  console.log(`   PATH exists: ${!!process.env.PATH}`);

  // Test with platform-specific options
  return new Promise((resolve) => {
    const claude = spawn(CLAUDE_CLI_PATH, ["--version"], spawnOptions);

    claude.on("close", (code) => {
      const success = code === 0;
      if (success) {
        console.log("   ✅ Platform-specific options work");
      } else {
        console.log("   ❌ Platform-specific options failed");
      }
      resolve({ success, exitCode: code });
    });

    claude.on("error", (err) => {
      console.log(`   ❌ Platform-specific test error: ${err.message}`);
      resolve({ success: false, error: err.message });
    });
  });
}

// Main test runner
async function runTests() {
  console.log("Starting Claude CLI validation tests...\n");

  const results = [];

  // Run all tests
  results.push(await testBasicVersion());
  results.push(await testProcessCleanup());
  results.push(await testErrorHandling());
  results.push(await testPlatformBehavior());

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("📊 Test Summary");
  console.log("=".repeat(50));

  const passed = results.filter((r) => r.success).length;
  const total = results.length;
  const passRate = Math.round((passed / total) * 100);

  console.log(`Tests Passed: ${passed}/${total} (${passRate}%)`);

  if (passed === total) {
    console.log("🎉 All tests passed! TypeScript implementation approach validated.");
    console.log("\nKey findings:");
    console.log("- Claude CLI is accessible and working");
    console.log("- Process spawning works in current environment");
    console.log("- Error handling behaves as expected");
    console.log("- Platform-specific options are working");
  } else {
    console.log(`⚠️ ${total - passed} test(s) failed.`);
  }

  return passed === total;
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
}

module.exports = { runTests };
