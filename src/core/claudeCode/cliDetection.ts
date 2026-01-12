/**
 * Claude CLI Detection
 *
 * Utilities for detecting the Claude CLI executable on the system.
 * Implements enhanced PATH resolution for GUI apps (like Obsidian) that
 * don't inherit the shell's full PATH.
 */

import { logInfo } from "@/logger";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const isWindows = process.platform === "win32";
const PATH_SEPARATOR = isWindows ? ";" : ":";
const NODE_EXECUTABLE = isWindows ? "node.exe" : "node";

/**
 * Common installation paths for the Claude CLI executable
 */
const CLAUDE_CLI_PATHS = {
  // macOS / Linux paths
  unix: [
    // User-local installation (most common)
    "~/.claude/local/claude",
    // Homebrew (macOS)
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    // System-wide installation
    "/usr/bin/claude",
    // npm global
    "~/.npm-global/bin/claude",
    // User local bin
    "~/.local/bin/claude",
  ],
  // Windows paths
  windows: [
    // User AppData
    "%LOCALAPPDATA%\\Claude\\claude.exe",
    "%APPDATA%\\Claude\\claude.exe",
    // Program Files
    "%ProgramFiles%\\Claude\\claude.exe",
    "%ProgramFiles(x86)%\\Claude\\claude.exe",
    // npm global on Windows
    "%APPDATA%\\npm\\claude.cmd",
  ],
};

/**
 * Get the user's home directory
 */
function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

/**
 * Expand environment variables and home directory in a path
 */
function expandPath(pathStr: string): string {
  let expanded = pathStr;

  // Expand home directory (~)
  if (expanded.startsWith("~")) {
    const homeDir = getHomeDir();
    expanded = expanded.replace("~", homeDir);
  }

  // Expand Windows environment variables
  if (isWindows) {
    expanded = expanded.replace(/%([^%]+)%/g, (_, varName) => {
      return process.env[varName] || "";
    });
  }

  return expanded;
}

/**
 * Check if a file exists and is a file (not directory)
 */
function isExistingFile(filePath: string): boolean {
  try {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      return stat.isFile();
    }
  } catch {
    // Ignore inaccessible paths
  }
  return false;
}

/**
 * Get platform-specific extra binary paths for GUI apps.
 * GUI apps like Obsidian have minimal PATH, so we add common locations.
 */
function getExtraBinaryPaths(): string[] {
  const home = getHomeDir();

  if (isWindows) {
    const paths: string[] = [];
    const localAppData = process.env.LOCALAPPDATA;
    const appData = process.env.APPDATA;
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const programData = process.env.ProgramData || "C:\\ProgramData";

    // Node.js / npm locations
    if (appData) {
      paths.push(path.join(appData, "npm"));
    }
    if (localAppData) {
      paths.push(path.join(localAppData, "Programs", "nodejs"));
      paths.push(path.join(localAppData, "Programs", "node"));
    }

    // Common program locations (official Node.js installer)
    paths.push(path.join(programFiles, "nodejs"));
    paths.push(path.join(programFilesX86, "nodejs"));

    // nvm-windows
    const nvmSymlink = process.env.NVM_SYMLINK;
    if (nvmSymlink) {
      paths.push(nvmSymlink);
    }
    const nvmHome = process.env.NVM_HOME;
    if (nvmHome) {
      paths.push(nvmHome);
    } else if (appData) {
      paths.push(path.join(appData, "nvm"));
    }

    // volta
    const voltaHome = process.env.VOLTA_HOME;
    if (voltaHome) {
      paths.push(path.join(voltaHome, "bin"));
    } else if (home) {
      paths.push(path.join(home, ".volta", "bin"));
    }

    // fnm
    const fnmMultishell = process.env.FNM_MULTISHELL_PATH;
    if (fnmMultishell) {
      paths.push(fnmMultishell);
    }
    const fnmDir = process.env.FNM_DIR;
    if (fnmDir) {
      paths.push(fnmDir);
    } else if (localAppData) {
      paths.push(path.join(localAppData, "fnm"));
    }

    // Chocolatey
    const chocolateyInstall = process.env.ChocolateyInstall;
    if (chocolateyInstall) {
      paths.push(path.join(chocolateyInstall, "bin"));
    } else {
      paths.push(path.join(programData, "chocolatey", "bin"));
    }

    // scoop
    const scoopDir = process.env.SCOOP;
    if (scoopDir) {
      paths.push(path.join(scoopDir, "shims"));
      paths.push(path.join(scoopDir, "apps", "nodejs", "current", "bin"));
      paths.push(path.join(scoopDir, "apps", "nodejs", "current"));
    } else if (home) {
      paths.push(path.join(home, "scoop", "shims"));
      paths.push(path.join(home, "scoop", "apps", "nodejs", "current", "bin"));
      paths.push(path.join(home, "scoop", "apps", "nodejs", "current"));
    }

    // User bin
    if (home) {
      paths.push(path.join(home, ".local", "bin"));
    }

    return paths;
  } else {
    // Unix paths
    const paths = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"];

    // volta
    const voltaHome = process.env.VOLTA_HOME;
    if (voltaHome) {
      paths.push(path.join(voltaHome, "bin"));
    }

    // asdf
    const asdfRoot = process.env.ASDF_DATA_DIR || process.env.ASDF_DIR;
    if (asdfRoot) {
      paths.push(path.join(asdfRoot, "shims"));
      paths.push(path.join(asdfRoot, "bin"));
    }

    // fnm
    const fnmMultishell = process.env.FNM_MULTISHELL_PATH;
    if (fnmMultishell) {
      paths.push(fnmMultishell);
    }
    const fnmDir = process.env.FNM_DIR;
    if (fnmDir) {
      paths.push(fnmDir);
    }

    if (home) {
      paths.push(path.join(home, ".local", "bin"));
      paths.push(path.join(home, ".docker", "bin"));
      paths.push(path.join(home, ".volta", "bin"));
      paths.push(path.join(home, ".asdf", "shims"));
      paths.push(path.join(home, ".asdf", "bin"));
      paths.push(path.join(home, ".fnm"));
      paths.push(path.join(home, ".bun", "bin"));

      // NVM: use NVM_BIN if set, otherwise skip
      const nvmBin = process.env.NVM_BIN;
      if (nvmBin) {
        paths.push(nvmBin);
      }
    }

    return paths;
  }
}

/**
 * Find nvm-managed Node.js installations by scanning ~/.nvm/versions/node/
 * Returns the bin directories of all installed node versions, sorted by version (newest first)
 */
function findNvmNodeDirectories(): string[] {
  const home = getHomeDir();
  const nvmVersionsDir = path.join(home, ".nvm", "versions", "node");

  try {
    if (!fs.existsSync(nvmVersionsDir)) {
      return [];
    }

    const entries = fs.readdirSync(nvmVersionsDir, { withFileTypes: true });
    const nodeBins: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith("v")) {
        const binDir = path.join(nvmVersionsDir, entry.name, "bin");
        const nodePath = path.join(binDir, NODE_EXECUTABLE);
        if (isExistingFile(nodePath)) {
          nodeBins.push(binDir);
        }
      }
    }

    // Sort by version number (newest first) so we prefer newer node versions
    nodeBins.sort((a, b) => {
      const versionA = path.basename(path.dirname(a));
      const versionB = path.basename(path.dirname(b));
      return versionB.localeCompare(versionA, undefined, { numeric: true });
    });

    return nodeBins;
  } catch {
    return [];
  }
}

/**
 * Searches for the Node.js executable in common installation locations.
 * Returns the directory containing node, or null if not found.
 */
function findNodeDirectory(): string | null {
  // First, check nvm installations (most common on macOS)
  const nvmDirs = findNvmNodeDirectories();
  if (nvmDirs.length > 0) {
    logInfo(`[ClaudeCode] Found nvm Node.js at: ${nvmDirs[0]}`);
    return nvmDirs[0];
  }

  // Check extra paths
  const searchPaths = getExtraBinaryPaths();

  // Also check current PATH
  const currentPath = process.env.PATH || "";
  const pathDirs = currentPath.split(PATH_SEPARATOR).filter((p) => p);

  // Search in extra paths first, then current PATH
  const allPaths = [...searchPaths, ...pathDirs];

  for (const dir of allPaths) {
    if (!dir) continue;
    try {
      const nodePath = path.join(dir, NODE_EXECUTABLE);
      if (isExistingFile(nodePath)) {
        logInfo(`[ClaudeCode] Found Node.js at: ${dir}`);
        return dir;
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  return null;
}

/**
 * Checks if a CLI path requires Node.js to execute (i.e., is a .js file or has node shebang)
 */
function cliPathRequiresNode(cliPath: string): boolean {
  const jsExtensions = [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"];
  const lower = cliPath.toLowerCase();
  if (jsExtensions.some((ext) => lower.endsWith(ext))) {
    return true;
  }

  try {
    if (!isExistingFile(cliPath)) {
      return false;
    }

    // Read the shebang to check if it's a node script
    let fd: number | null = null;
    try {
      fd = fs.openSync(cliPath, "r");
      const buffer = new Uint8Array(200);
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const header = new TextDecoder().decode(buffer.slice(0, bytesRead));
      return header.startsWith("#!") && header.toLowerCase().includes("node");
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          // Ignore close errors
        }
      }
    }
  } catch {
    return false;
  }
}

/**
 * Returns an enhanced PATH that includes common binary locations.
 * GUI apps like Obsidian have minimal PATH, so we need to add standard locations
 * where binaries like node are typically installed.
 *
 * @param cliPath - Optional CLI path. If provided and its directory contains node,
 *                  that directory is added to PATH.
 */
export function getEnhancedPath(cliPath?: string): string {
  const extraPaths = getExtraBinaryPaths().filter((p) => p);
  const currentPath = process.env.PATH || "";

  // Build path segments
  const segments: string[] = [];

  // Add nvm node directories first (most important for macOS)
  const nvmDirs = findNvmNodeDirectories();
  if (nvmDirs.length > 0) {
    logInfo(`[ClaudeCode] Adding nvm node directories to PATH: ${nvmDirs.join(", ")}`);
  }
  segments.push(...nvmDirs);

  // If CLI path is provided, check if its directory contains node executable
  let cliDirHasNode = false;
  if (cliPath) {
    try {
      const cliDir = path.dirname(cliPath);
      const nodeInCliDir = path.join(cliDir, NODE_EXECUTABLE);
      if (isExistingFile(nodeInCliDir)) {
        segments.push(cliDir);
        cliDirHasNode = true;
      }
    } catch {
      // Ignore errors
    }
  }

  // Fallback: If CLI requires node and we didn't find node in CLI dir, search common locations
  if (cliPath && cliPathRequiresNode(cliPath) && !cliDirHasNode && nvmDirs.length === 0) {
    const nodeDir = findNodeDirectory();
    if (nodeDir) {
      segments.push(nodeDir);
    }
  }

  // Add extra paths
  segments.push(...extraPaths);

  // Add current PATH
  if (currentPath) {
    segments.push(...currentPath.split(PATH_SEPARATOR).filter((p) => p));
  }

  // Deduplicate while preserving order
  const seen = new Set<string>();
  const unique = segments.filter((p) => {
    const normalized = isWindows ? p.toLowerCase() : p;
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });

  return unique.join(PATH_SEPARATOR);
}

/**
 * Get environment with enhanced PATH for spawning processes.
 * This is the main function to call when spawning child processes that need
 * access to node/npm binaries that might not be in the default Electron PATH.
 *
 * @param cliPath - Optional CLI path to help locate node
 * @returns Environment variables with enhanced PATH
 */
export function getEnhancedEnv(cliPath?: string): Record<string, string> {
  const enhancedPath = getEnhancedPath(cliPath);
  return {
    ...process.env,
    PATH: enhancedPath,
  } as Record<string, string>;
}

/**
 * Find the Claude CLI executable path
 *
 * Searches common installation locations for the Claude CLI.
 * Returns the first valid executable path found, or null if not found.
 *
 * @returns Promise resolving to the CLI path or null if not found
 */
export async function findClaudeCliPath(): Promise<string | null> {
  const platform = process.platform;
  const paths = platform === "win32" ? CLAUDE_CLI_PATHS.windows : CLAUDE_CLI_PATHS.unix;

  logInfo("[ClaudeCode] Searching for Claude CLI executable...");

  for (const pathPattern of paths) {
    const expandedPath = expandPath(pathPattern);
    if (isExistingFile(expandedPath)) {
      logInfo(`[ClaudeCode] Found Claude CLI at: ${expandedPath}`);
      return expandedPath;
    }
  }

  // Try to find in PATH using 'which' (Unix) or 'where' (Windows)
  try {
    const childProcess = await import("child_process");
    const { promisify } = await import("util");
    const exec = promisify(childProcess.exec);

    const command = platform === "win32" ? "where claude" : "which claude";
    const { stdout } = await exec(command, {
      env: getEnhancedEnv(),
    });
    const cliPath = stdout.trim().split("\n")[0];

    if (cliPath && isExistingFile(cliPath)) {
      logInfo(`[ClaudeCode] Found Claude CLI in PATH: ${cliPath}`);
      return cliPath;
    }
  } catch {
    // Command not found in PATH
  }

  logInfo("[ClaudeCode] Claude CLI not found");
  return null;
}

/**
 * Check if Claude CLI is available on the system
 *
 * @returns Promise resolving to true if CLI is available
 */
export async function isClaudeCliAvailable(): Promise<boolean> {
  const cliPath = await findClaudeCliPath();
  return cliPath !== null;
}

/**
 * Get the Claude CLI version
 *
 * @param cliPath - Optional path to the CLI executable
 * @returns Promise resolving to version string or null if unavailable
 */
export async function getClaudeCliVersion(cliPath?: string): Promise<string | null> {
  try {
    const cliPathToUse = cliPath || (await findClaudeCliPath());
    if (!cliPathToUse) {
      return null;
    }

    const childProcess = await import("child_process");
    const { promisify } = await import("util");
    const exec = promisify(childProcess.exec);

    const { stdout } = await exec(`"${cliPathToUse}" --version`, {
      env: getEnhancedEnv(cliPathToUse),
    });
    const version = stdout.trim();
    logInfo(`[ClaudeCode] CLI version: ${version}`);
    return version;
  } catch {
    return null;
  }
}

// Legacy export for backward compatibility
export const getShellEnvironment = getEnhancedEnv;
