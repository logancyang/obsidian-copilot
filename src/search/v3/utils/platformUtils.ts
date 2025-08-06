import { Platform } from "obsidian";

/**
 * Get platform-specific value
 * @param mobile - Value for mobile platform
 * @param desktop - Value for desktop platform
 * @returns The appropriate value based on platform
 */
export const getPlatformValue = <T>(mobile: T, desktop: T): T =>
  Platform.isMobile ? mobile : desktop;
