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
 * Escapes special XML characters for use in XML attributes
 * @param str - The string to escape for attribute use
 * @returns The escaped string safe for XML attributes
 */
export function escapeXmlAttribute(str: string): string {
  return escapeXml(str);
}
