/**
 * Claude CLI Validation Test Script
 *
 * Comprehensive test suite to validate Claude CLI execution
 * from Node.js within Obsidian's Electron environment.
 *
 * Story 1.3: Basic CLI Validation
 */

import { ClaudeCliInterface } from "./ClaudeCliInterface";
import { MacOSHandler } from "./platform/MacOSHandler";
import { WindowsHandler } from "./platform/WindowsHandler";
import { LinuxHandler } from "./platform/LinuxHandler";

export interface TestResult {
  test: string;
  success: boolean;
  message: string;
  details?: any;
  platform: string;
}

export class ClaudeCliValidator {
  private cliInterface: ClaudeCliInterface;
  private results: TestResult[] = [];
  private platform: string;

  constructor(cliPath: string = "claude") {
    this.cliInterface = new ClaudeCliInterface({ cliPath });
    this.platform = process.platform;
  }

  /**
   * Run all CLI validation tests
   */
  async runAllTests(): Promise<TestResult[]> {
    this.results = [];

    console.log("🔍 Starting Claude CLI Validation Tests...");
    console.log(`Platform: ${this.platform}`);
    console.log("=".repeat(50));

    // Core functionality tests
    await this.testBasicCliVersion();
    await this.testProcessSpawning();
    await this.testErrorHandling();
    await this.testOutputCapture();

    // Platform-specific tests
    await this.testPlatformSpecifics();

    // Integration tests
    await this.testElectronCompatibility();

    this.printSummary();
    return this.results;
  }

  /**
   * Test 1: Basic CLI Version Command
   */
  private async testBasicCliVersion(): Promise<void> {
    console.log("🧪 Test 1: Basic CLI Version Command");

    try {
      const result = await this.cliInterface.testCliVersion();

      if (result.success && result.version) {
        this.addResult("basic-version", true, `✅ Claude CLI found: ${result.version}`, result);
        console.log(`   ✅ Success - Version: ${result.version}`);
      } else {
        this.addResult(
          "basic-version",
          false,
          `❌ Claude CLI not found or version check failed`,
          result
        );
        console.log(`   ❌ Failed - ${result.error || "Unknown error"}`);
      }
    } catch (error) {
      this.addResult("basic-version", false, `❌ Exception during version test: ${error}`, {
        error,
      });
      console.log(`   ❌ Exception: ${error}`);
    }
  }

  /**
   * Test 2: Process Spawning Capabilities
   */
  private async testProcessSpawning(): Promise<void> {
    console.log("🧪 Test 2: Process Spawning Capabilities");

    try {
      const isValid = await this.cliInterface.validateCli();

      if (isValid) {
        this.addResult("process-spawning", true, "✅ Process spawning works correctly");
        console.log("   ✅ Process spawning successful");
      } else {
        this.addResult("process-spawning", false, "❌ Process spawning failed");
        console.log("   ❌ Process spawning failed");
      }
    } catch (error) {
      this.addResult("process-spawning", false, `❌ Process spawning exception: ${error}`, {
        error,
      });
      console.log(`   ❌ Exception: ${error}`);
    }
  }

  /**
   * Test 3: Error Handling
   */
  private async testErrorHandling(): Promise<void> {
    console.log("🧪 Test 3: Error Handling");

    try {
      // Test with invalid CLI path
      const invalidCli = new ClaudeCliInterface({ cliPath: "nonexistent-claude-cli" });
      const result = await invalidCli.testCliVersion();

      if (!result.success && (result.error || result.exitCode !== 0)) {
        this.addResult("error-handling", true, "✅ Error handling works correctly", result);
        console.log("   ✅ Error handling successful");
      } else {
        this.addResult(
          "error-handling",
          false,
          "❌ Error handling failed - should have failed for invalid CLI",
          result
        );
        console.log("   ❌ Error handling failed");
      }
    } catch (error) {
      this.addResult("error-handling", false, `❌ Error handling test exception: ${error}`, {
        error,
      });
      console.log(`   ❌ Exception: ${error}`);
    }
  }

  /**
   * Test 4: Output Capture (stdout, stderr, exit codes)
   */
  private async testOutputCapture(): Promise<void> {
    console.log("🧪 Test 4: Output Capture");

    try {
      const result = await this.cliInterface.testCliVersion();

      const hasStdout = typeof result.stdout === "string";
      const hasStderr = typeof result.stderr === "string";
      const hasExitCode = typeof result.exitCode === "number";

      if (hasStdout && hasStderr && hasExitCode) {
        this.addResult("output-capture", true, "✅ Output capture working correctly", {
          stdoutLength: result.stdout.length,
          stderrLength: result.stderr.length,
          exitCode: result.exitCode,
        });
        console.log("   ✅ Output capture successful");
      } else {
        this.addResult("output-capture", false, "❌ Output capture incomplete", result);
        console.log("   ❌ Output capture failed");
      }
    } catch (error) {
      this.addResult("output-capture", false, `❌ Output capture test exception: ${error}`, {
        error,
      });
      console.log(`   ❌ Exception: ${error}`);
    }
  }

  /**
   * Test 5: Platform-Specific Behavior
   */
  private async testPlatformSpecifics(): Promise<void> {
    console.log("🧪 Test 5: Platform-Specific Behavior");

    try {
      let handler;
      let commonPaths: string[] = [];

      switch (this.platform) {
        case "darwin":
          handler = new MacOSHandler();
          commonPaths = handler.getCommonPaths();
          break;
        case "win32":
          handler = new WindowsHandler();
          commonPaths = handler.getCommonPaths();
          break;
        case "linux":
          handler = new LinuxHandler();
          commonPaths = handler.getCommonPaths();
          break;
        default:
          this.addResult("platform-specifics", false, `❌ Unsupported platform: ${this.platform}`);
          console.log(`   ❌ Unsupported platform: ${this.platform}`);
          return;
      }

      const spawnOptions = handler.getSpawnOptions();
      const hasValidOptions = spawnOptions && typeof spawnOptions === "object";
      const hasCommonPaths = commonPaths && commonPaths.length > 0;

      if (hasValidOptions && hasCommonPaths) {
        this.addResult(
          "platform-specifics",
          true,
          `✅ Platform-specific handling for ${this.platform}`,
          {
            commonPaths: commonPaths.length,
            spawnOptions: Object.keys(spawnOptions),
          }
        );
        console.log(`   ✅ Platform-specific handling successful`);
      } else {
        this.addResult(
          "platform-specifics",
          false,
          `❌ Platform-specific handling incomplete for ${this.platform}`
        );
        console.log(`   ❌ Platform-specific handling failed`);
      }
    } catch (error) {
      this.addResult("platform-specifics", false, `❌ Platform-specific test exception: ${error}`, {
        error,
      });
      console.log(`   ❌ Exception: ${error}`);
    }
  }

  /**
   * Test 6: Electron Environment Compatibility
   */
  private async testElectronCompatibility(): Promise<void> {
    console.log("🧪 Test 6: Electron Environment Compatibility");

    try {
      // Check if we're running in Electron
      const isElectron =
        typeof window !== "undefined" && typeof (window as any).process === "object";

      // Test process spawning in current environment
      const result = await this.cliInterface.testCliVersion();

      if (result.success || result.error?.includes("ENOENT")) {
        // Either CLI works or fails with expected "command not found" error
        this.addResult(
          "electron-compatibility",
          true,
          "✅ Process spawning works in current environment",
          {
            isElectron,
            canSpawnProcess: true,
            result: result.success ? "CLI found" : "CLI not found but spawning works",
          }
        );
        console.log("   ✅ Electron compatibility confirmed");
      } else {
        this.addResult(
          "electron-compatibility",
          false,
          "❌ Process spawning blocked or failed in current environment",
          {
            isElectron,
            error: result.error,
          }
        );
        console.log("   ❌ Electron compatibility failed");
      }
    } catch (error) {
      this.addResult(
        "electron-compatibility",
        false,
        `❌ Electron compatibility test exception: ${error}`,
        { error }
      );
      console.log(`   ❌ Exception: ${error}`);
    }
  }

  /**
   * Add test result to results array
   */
  private addResult(test: string, success: boolean, message: string, details?: any): void {
    this.results.push({
      test,
      success,
      message,
      details,
      platform: this.platform,
    });
  }

  /**
   * Print test summary
   */
  private printSummary(): void {
    console.log("\n" + "=".repeat(50));
    console.log("📊 Test Summary");
    console.log("=".repeat(50));

    const passed = this.results.filter((r) => r.success).length;
    const total = this.results.length;
    const passRate = Math.round((passed / total) * 100);

    console.log(`Platform: ${this.platform}`);
    console.log(`Tests Passed: ${passed}/${total} (${passRate}%)`);
    console.log("");

    this.results.forEach((result) => {
      const icon = result.success ? "✅" : "❌";
      console.log(`${icon} ${result.test}: ${result.message}`);
    });

    console.log("");

    if (passed === total) {
      console.log("🎉 All tests passed! Claude CLI validation successful.");
    } else {
      console.log(`⚠️  ${total - passed} test(s) failed. Check logs above for details.`);
    }
  }

  /**
   * Get test results
   */
  getResults(): TestResult[] {
    return this.results;
  }

  /**
   * Check if all tests passed
   */
  allTestsPassed(): boolean {
    return this.results.every((result) => result.success);
  }
}

/**
 * Standalone test function for easy execution
 */
export async function testClaudeCLI(cliPath?: string): Promise<boolean> {
  const validator = new ClaudeCliValidator(cliPath);
  await validator.runAllTests();
  return validator.allTestsPassed();
}

/**
 * Main execution when run directly
 */
if (typeof require !== "undefined" && require.main === module) {
  testClaudeCLI()
    .then((success) => {
      if (typeof process !== "undefined") {
        process.exit(success ? 0 : 1);
      }
    })
    .catch((error) => {
      console.error("Fatal error during CLI testing:", error);
      if (typeof process !== "undefined") {
        process.exit(1);
      }
    });
}
