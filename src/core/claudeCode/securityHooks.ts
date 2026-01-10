/**
 * Security Hooks for Claude Code
 *
 * Provides security checks for tool execution including:
 * - Blocklist hook: Blocks dangerous commands
 * - Vault restriction hook: Ensures file operations stay within allowed paths
 */

import { logInfo, logWarn } from "@/logger";
import * as path from "path";

/**
 * Result of a security check
 */
export interface SecurityCheckResult {
  /** Whether the operation is allowed */
  allowed: boolean;
  /** Reason for blocking (if blocked) */
  reason?: string;
}

/**
 * Result of command blocklist check
 */
export interface BlocklistCheckResult {
  /** Whether the command is blocked */
  blocked: boolean;
  /** Reason for blocking (if blocked) */
  reason?: string;
}

/**
 * Options for creating security hooks
 */
export interface SecurityHooksOptions {
  /** Path to the vault directory */
  vaultPath: string;
  /** Additional allowed paths beyond the vault */
  allowedPaths: string[];
  /** Command patterns to block */
  blockedCommands: string[];
}

/**
 * Default dangerous command patterns
 * These are platform-aware and cover both Unix and Windows commands
 */
export const DEFAULT_BLOCKED_COMMANDS: string[] = [
  // Unix destructive commands
  "rm -rf /",
  "rm -rf ~",
  "rm -rf /*",
  "rm -rf ~/*",
  "sudo rm",
  "> /dev/sda",
  "> /dev/hda",
  "mkfs.",
  "dd if=",
  ":(){:|:&};:", // Fork bomb
  "chmod 777 /",
  "chmod -R 777 /",
  "chown -R",

  // Windows destructive commands
  "format c:",
  "rd /s /q c:",
  "del /f /s /q c:",
  "rmdir /s /q c:",

  // Other dangerous patterns
  "curl | sh",
  "wget | sh",
  "curl | bash",
  "wget | bash",
  "> /etc/passwd",
  "> /etc/shadow",
  "shutdown",
  "reboot",
  "init 0",
  "init 6",
];

/**
 * File operation tool names that require path validation
 */
const FILE_OPERATION_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep"];

/**
 * Check if a command matches any blocked pattern
 *
 * Performs case-insensitive matching and handles various command formats.
 *
 * @param command - The command to check
 * @param blockedPatterns - Array of blocked command patterns
 * @returns BlocklistCheckResult indicating if command is blocked
 */
export function isCommandBlocked(command: string, blockedPatterns: string[]): BlocklistCheckResult {
  if (!command || typeof command !== "string") {
    return { blocked: false };
  }

  const normalizedCommand = command.toLowerCase().trim();

  for (const pattern of blockedPatterns) {
    const normalizedPattern = pattern.toLowerCase().trim();

    // Check if command contains the blocked pattern
    if (normalizedCommand.includes(normalizedPattern)) {
      logWarn(`[SecurityHooks] Blocked command pattern detected: "${pattern}"`);
      return {
        blocked: true,
        reason: `Command contains blocked pattern: "${pattern}"`,
      };
    }
  }

  return { blocked: false };
}

/**
 * Normalize a file path for comparison
 *
 * @param filePath - The path to normalize
 * @returns Normalized absolute path
 */
function normalizePath(filePath: string): string {
  // Handle empty or invalid paths
  if (!filePath || typeof filePath !== "string") {
    return "";
  }

  // Resolve to absolute path and normalize
  try {
    return path.resolve(filePath).toLowerCase();
  } catch {
    return filePath.toLowerCase();
  }
}

/**
 * Check if a file path is within allowed paths
 *
 * Validates that file operations stay within the vault or other allowed directories.
 *
 * @param filePath - The file path to check
 * @param allowedPaths - Array of allowed directory paths
 * @param vaultPath - Path to the vault directory
 * @returns true if path is allowed, false otherwise
 */
export function isPathAllowed(
  filePath: string,
  allowedPaths: string[],
  vaultPath: string
): boolean {
  if (!filePath || typeof filePath !== "string") {
    return false;
  }

  const normalizedFilePath = normalizePath(filePath);
  const normalizedVaultPath = normalizePath(vaultPath);

  // Check if path is within vault
  if (normalizedFilePath.startsWith(normalizedVaultPath)) {
    return true;
  }

  // Check if path is within any allowed path
  for (const allowedPath of allowedPaths) {
    const normalizedAllowedPath = normalizePath(allowedPath);
    if (normalizedFilePath.startsWith(normalizedAllowedPath)) {
      return true;
    }
  }

  return false;
}

/**
 * Extract file paths from a bash command
 *
 * Attempts to parse common bash command patterns to extract file paths.
 * This is a best-effort extraction and may not catch all paths.
 *
 * @param command - The bash command to parse
 * @returns Array of potential file paths found in the command
 */
function extractPathsFromCommand(command: string): string[] {
  const paths: string[] = [];

  // Match absolute paths (Unix and Windows)
  const absolutePathRegex = /(?:^|[\s"'=])([\\/](?:[^\s"'\\]|\\.)+)/g;
  let match: RegExpExecArray | null;
  while ((match = absolutePathRegex.exec(command)) !== null) {
    const potentialPath = match[1].trim();
    if (potentialPath && potentialPath.length > 1) {
      paths.push(potentialPath);
    }
  }

  // Match quoted paths
  const quotedPathRegex = /["']([^"']+)["']/g;
  while ((match = quotedPathRegex.exec(command)) !== null) {
    const potentialPath = match[1].trim();
    // Only add if it looks like a path (starts with / or contains path separators)
    if (potentialPath && (potentialPath.startsWith("/") || potentialPath.includes(path.sep))) {
      paths.push(potentialPath);
    }
  }

  // Match home directory paths
  const homePathRegex = /~\/[^\s"']+/g;
  while ((match = homePathRegex.exec(command)) !== null) {
    // Expand ~ to home directory
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    const expandedPath = match[0].replace("~", homeDir);
    paths.push(expandedPath);
  }

  return [...new Set(paths)]; // Remove duplicates
}

/**
 * Create security hooks for Claude Code tool execution
 *
 * Returns pre-tool-use hooks that check for:
 * 1. Blocked commands (for Bash tool)
 * 2. Path restrictions (for file operation tools)
 *
 * @param options - Security hooks configuration
 * @returns Object containing preToolUse hook function
 */
export function createSecurityHooks(options: SecurityHooksOptions) {
  const { vaultPath, allowedPaths, blockedCommands } = options;

  logInfo(
    `[SecurityHooks] Initialized with vault: ${vaultPath}, allowed paths: ${allowedPaths.length}`
  );

  /**
   * Pre-tool-use hook to validate tool execution
   *
   * @param toolName - Name of the tool being invoked
   * @param input - Tool input parameters
   * @returns SecurityCheckResult indicating if tool execution is allowed
   */
  function preToolUse(toolName: string, input: Record<string, unknown>): SecurityCheckResult {
    logInfo(`[SecurityHooks] Checking tool: ${toolName}`);

    // Check Bash commands for blocklist
    if (toolName === "Bash") {
      const command = input.command as string | undefined;
      if (command) {
        // Check against blocklist
        const blocklistResult = isCommandBlocked(command, blockedCommands);
        if (blocklistResult.blocked) {
          return {
            allowed: false,
            reason: blocklistResult.reason,
          };
        }

        // Check paths in the command
        const paths = extractPathsFromCommand(command);
        for (const extractedPath of paths) {
          if (!isPathAllowed(extractedPath, allowedPaths, vaultPath)) {
            logWarn(`[SecurityHooks] Path outside allowed areas: ${extractedPath}`);
            return {
              allowed: false,
              reason: `Command accesses path outside allowed areas: ${extractedPath}`,
            };
          }
        }
      }
    }

    // Check file operation tools for path restrictions
    if (FILE_OPERATION_TOOLS.includes(toolName)) {
      // Get the path from various possible input fields
      const filePath =
        (input.file_path as string) ||
        (input.path as string) ||
        (input.filePath as string) ||
        (input.target as string);

      if (filePath && !isPathAllowed(filePath, allowedPaths, vaultPath)) {
        logWarn(`[SecurityHooks] File operation blocked - path outside allowed areas: ${filePath}`);
        return {
          allowed: false,
          reason: `File path outside allowed areas: ${filePath}`,
        };
      }

      // For Glob and Grep, also check the search path
      if (toolName === "Glob" || toolName === "Grep") {
        const searchPath = input.path as string | undefined;
        if (searchPath && !isPathAllowed(searchPath, allowedPaths, vaultPath)) {
          logWarn(
            `[SecurityHooks] Search operation blocked - path outside allowed areas: ${searchPath}`
          );
          return {
            allowed: false,
            reason: `Search path outside allowed areas: ${searchPath}`,
          };
        }
      }
    }

    // All checks passed
    return { allowed: true };
  }

  return {
    preToolUse,
  };
}

/**
 * Validate a path against security restrictions
 *
 * Utility function for checking if a specific path is within security boundaries.
 *
 * @param filePath - Path to validate
 * @param options - Security options
 * @returns SecurityCheckResult
 */
export function validatePath(filePath: string, options: SecurityHooksOptions): SecurityCheckResult {
  const { vaultPath, allowedPaths } = options;

  if (!isPathAllowed(filePath, allowedPaths, vaultPath)) {
    return {
      allowed: false,
      reason: `Path is outside allowed areas: ${filePath}`,
    };
  }

  return { allowed: true };
}

/**
 * Validate a bash command against security restrictions
 *
 * Utility function for checking a bash command before execution.
 *
 * @param command - Command to validate
 * @param options - Security options
 * @returns SecurityCheckResult
 */
export function validateBashCommand(
  command: string,
  options: SecurityHooksOptions
): SecurityCheckResult {
  const { vaultPath, allowedPaths, blockedCommands } = options;

  // Check blocklist
  const blocklistResult = isCommandBlocked(command, blockedCommands);
  if (blocklistResult.blocked) {
    return {
      allowed: false,
      reason: blocklistResult.reason,
    };
  }

  // Check paths in command
  const paths = extractPathsFromCommand(command);
  for (const extractedPath of paths) {
    if (!isPathAllowed(extractedPath, allowedPaths, vaultPath)) {
      return {
        allowed: false,
        reason: `Command accesses path outside allowed areas: ${extractedPath}`,
      };
    }
  }

  return { allowed: true };
}
