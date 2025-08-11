/**
 * Utility class for validating vault file paths to prevent security issues
 * like path traversal attacks and ensure only markdown files are processed.
 */
export class VaultPathValidator {
  private static readonly MARKDOWN_EXTENSIONS = [".md", ".markdown"] as const;

  /**
   * Validates if a path is safe to use within the vault.
   * Prevents path traversal attacks and ensures proper file types.
   *
   * @param path - The path to validate
   * @returns true if the path is valid and safe
   */
  static isValid(path: string): boolean {
    return (
      !!path &&
      typeof path === "string" &&
      !path.startsWith("/") && // No absolute paths
      !path.startsWith("\\") && // No Windows absolute paths
      !path.includes("..") && // No parent directory traversal
      !path.includes("~") && // No home directory expansion
      this.hasValidExtension(path)
    );
  }

  /**
   * Checks if the path has a valid markdown extension.
   *
   * @param path - The path to check
   * @returns true if the path ends with a markdown extension
   */
  private static hasValidExtension(path: string): boolean {
    const lower = path.toLowerCase();
    return this.MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
  }

  /**
   * Sanitizes a path by removing potentially dangerous characters.
   * This is a more permissive check that allows fixing paths.
   *
   * @param path - The path to sanitize
   * @returns The sanitized path or null if unsalvageable
   */
  static sanitize(path: string): string | null {
    if (!path || typeof path !== "string") return null;

    // Remove dangerous patterns
    let sanitized = path
      .replace(/\.\./g, "") // Remove parent directory references
      .replace(/^[/\\]+/, "") // Remove leading slashes
      .replace(/~\//g, "") // Remove home directory references
      .trim();

    // Ensure markdown extension
    if (!this.hasValidExtension(sanitized)) {
      // If no extension, add .md
      if (!sanitized.includes(".")) {
        sanitized += ".md";
      } else {
        // Has wrong extension, reject
        return null;
      }
    }

    return sanitized || null;
  }

  /**
   * Validates multiple paths and returns only the valid ones.
   *
   * @param paths - Array of paths to validate
   * @returns Array of valid paths
   */
  static filterValid(paths: string[]): string[] {
    return paths.filter((path) => this.isValid(path));
  }
}
