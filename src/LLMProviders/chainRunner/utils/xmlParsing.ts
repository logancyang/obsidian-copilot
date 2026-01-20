/**
 * XML utility functions for context envelope processing.
 * These are used for escaping/unescaping content in the XML context envelope,
 * NOT for tool calling (which now uses native LangChain tool calling).
 */

/**
 * Escapes special XML characters in a string to prevent XML injection
 * @param str - The string to escape
 * @returns The escaped string safe for XML content
 */
export function escapeXml(str: string): string {
  if (typeof str !== "string") {
    return "";
  }

  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Unescapes XML entities back to their original characters.
 * Used when extracting content that was previously escaped (e.g., image URLs).
 * @param str - The XML-escaped string to unescape
 * @returns The unescaped string with original characters restored
 */
export function unescapeXml(str: string): string {
  if (typeof str !== "string") {
    return "";
  }

  // Reason: &amp; must be unescaped last to prevent double-unescaping
  return str
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

/**
 * Escapes special XML characters for use in XML attributes
 * @param str - The string to escape for attribute use
 * @returns The escaped string safe for XML attributes
 */
export function escapeXmlAttribute(str: string): string {
  return escapeXml(str);
}
