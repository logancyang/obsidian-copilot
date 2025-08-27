/**
 * Claude CLI Integration Test for Obsidian Plugin Context
 *
 * Tests the Claude CLI functionality within the actual Obsidian plugin environment.
 * This file is designed to be called from the plugin's main code to validate
 * CLI integration during plugin initialization or on-demand testing.
 */

import { ClaudeCliInterface } from "./ClaudeCliInterface";

export interface IntegrationTestResult {
  testName: string;
  success: boolean;
  message: string;
  duration: number;
  details?: any;
}

export class ClaudeCliIntegrationTester {
  private cliInterface: ClaudeCliInterface;

  constructor(cliPath: string = "claude") {
    this.cliInterface = new ClaudeCliInterface({ cliPath });
  }

  /**
   * Run core integration tests for Obsidian plugin context
   */
  async runCoreTests(): Promise<IntegrationTestResult[]> {
    const results: IntegrationTestResult[] = [];

    // Test 1: Basic CLI Detection
    results.push(await this.timedTest("CLI Detection", () => this.testCliDetection()));

    // Test 2: Version Validation
    results.push(await this.timedTest("Version Validation", () => this.testVersionValidation()));

    // Test 3: Process Management
    results.push(await this.timedTest("Process Management", () => this.testProcessManagement()));

    return results;
  }

  /**
   * Test CLI detection and basic functionality
   */
  private async testCliDetection(): Promise<{ success: boolean; message: string; details?: any }> {
    try {
      const isValid = await this.cliInterface.validateCli();

      if (isValid) {
        return {
          success: true,
          message: "Claude CLI detected and validated successfully",
        };
      } else {
        return {
          success: false,
          message: "Claude CLI not found or validation failed",
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `CLI detection failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        details: { error },
      };
    }
  }

  /**
   * Test version command and parsing
   */
  private async testVersionValidation(): Promise<{
    success: boolean;
    message: string;
    details?: any;
  }> {
    try {
      const result = await this.cliInterface.testCliVersion();

      if (result.success && result.version) {
        return {
          success: true,
          message: `Version validation successful: ${result.version}`,
          details: { version: result.version, stdout: result.stdout },
        };
      } else {
        return {
          success: false,
          message: "Version validation failed",
          details: result,
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `Version validation error: ${error instanceof Error ? error.message : "Unknown error"}`,
        details: { error },
      };
    }
  }

  /**
   * Test process management and cleanup
   */
  private async testProcessManagement(): Promise<{
    success: boolean;
    message: string;
    details?: any;
  }> {
    try {
      // Test multiple rapid calls to ensure process management is working
      const promises = Array.from({ length: 3 }, () => this.cliInterface.testCliVersion());

      const results = await Promise.all(promises);
      const successCount = results.filter((r) => r.success).length;

      if (successCount === 3) {
        return {
          success: true,
          message: "Process management test passed - multiple concurrent calls handled correctly",
          details: { successfulCalls: successCount, totalCalls: 3 },
        };
      } else {
        return {
          success: false,
          message: `Process management issues detected - only ${successCount}/3 calls succeeded`,
          details: { successfulCalls: successCount, totalCalls: 3, results },
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `Process management test error: ${error instanceof Error ? error.message : "Unknown error"}`,
        details: { error },
      };
    }
  }

  /**
   * Run a test with timing
   */
  private async timedTest(
    testName: string,
    testFn: () => Promise<{ success: boolean; message: string; details?: any }>
  ): Promise<IntegrationTestResult> {
    const startTime = Date.now();

    try {
      const result = await testFn();
      const duration = Date.now() - startTime;

      return {
        testName,
        success: result.success,
        message: result.message,
        duration,
        details: result.details,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      return {
        testName,
        success: false,
        message: `Test execution failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        duration,
        details: { error },
      };
    }
  }

  /**
   * Quick validation check for plugin initialization
   */
  async quickValidation(): Promise<boolean> {
    try {
      return await this.cliInterface.validateCli();
    } catch {
      return false;
    }
  }

  /**
   * Get detailed validation info for debugging
   */
  async getValidationInfo(): Promise<{
    isValid: boolean;
    version?: string;
    error?: string;
    platform: string;
    timestamp: number;
  }> {
    const timestamp = Date.now();
    const platform = process.platform;

    try {
      const result = await this.cliInterface.testCliVersion();

      return {
        isValid: result.success,
        version: result.version,
        error: result.error,
        platform,
        timestamp,
      };
    } catch (error) {
      return {
        isValid: false,
        error: error instanceof Error ? error.message : "Unknown error",
        platform,
        timestamp,
      };
    }
  }
}

/**
 * Convenience function for quick CLI validation
 */
export async function validateClaudeCli(cliPath?: string): Promise<boolean> {
  const tester = new ClaudeCliIntegrationTester(cliPath || "claude");
  return await tester.quickValidation();
}

/**
 * Convenience function for detailed validation info
 */
export async function getClaudeCliInfo(cliPath?: string) {
  const tester = new ClaudeCliIntegrationTester(cliPath || "claude");
  return await tester.getValidationInfo();
}
