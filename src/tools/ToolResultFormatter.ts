/**
 * Derive a user-facing label from a readNote tool path.
 *
 * @param rawNotePath - Original note path supplied to the readNote tool.
 * @returns Sanitized display name without directories, extensions, or wiki syntax.
 */
export function deriveReadNoteDisplayName(rawNotePath: string): string {
  const trimmed = rawNotePath.trim();
  if (!trimmed) {
    return "note";
  }

  const wikiMatch = trimmed.match(/^\[\[([\s\S]+?)\]\]$/);
  const withoutWiki = wikiMatch ? wikiMatch[1] : trimmed;

  const [targetPartRaw = "", aliasPartRaw = ""] = withoutWiki.split("|");
  const aliasPart = aliasPartRaw.trim();
  if (aliasPart.length > 0) {
    return aliasPart;
  }

  const targetPart = targetPartRaw.trim();
  const [withoutSection] = targetPart.split("#");
  const coreTarget = (withoutSection || targetPart).trim() || trimmed;

  const segments = coreTarget.split("/").filter(Boolean);
  const lastSegment = segments.length > 0 ? segments[segments.length - 1] : coreTarget;

  const withoutExtension = lastSegment.replace(/\.[^/.]+$/, "");
  return withoutExtension || lastSegment || "note";
}

const READ_NOTE_SUMMARY_MAX_LENGTH = 180;

function clampReadNoteMessage(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length <= READ_NOTE_SUMMARY_MAX_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, READ_NOTE_SUMMARY_MAX_LENGTH)}…`;
}

function summarizeReadNotePayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const p = payload as Record<string, unknown>;
  const status = typeof p.status === "string" ? p.status : null;
  const message =
    typeof p.message === "string" && p.message.trim().length > 0
      ? clampReadNoteMessage(p.message)
      : null;
  const notePath = typeof p.notePath === "string" ? p.notePath : "";
  const noteTitle =
    typeof p.noteTitle === "string" && p.noteTitle.trim().length > 0
      ? p.noteTitle.trim()
      : deriveReadNoteDisplayName(notePath);
  const displayName = noteTitle || deriveReadNoteDisplayName(notePath);

  if (status === "invalid_path") {
    return message ?? `⚠️ Invalid note path "${displayName}"`;
  }
  if (status === "not_found") {
    return message ?? `⚠️ Note "${displayName}" not found`;
  }
  if (status === "not_unique") {
    const candidateCount = Array.isArray(p.candidates) ? p.candidates.length : 0;
    if (message) {
      return message;
    }
    return candidateCount > 0
      ? `⚠️ Multiple matches for "${displayName}" (${candidateCount} candidates)`
      : `⚠️ Multiple matches for "${displayName}"`;
  }
  if (status === "empty") {
    return message ?? `⚠️ "${displayName}" contains no readable content`;
  }
  if (status === "out_of_range") {
    if (message) {
      return message;
    }
    const totalChunks =
      typeof p.totalChunks === "number" && Number.isFinite(p.totalChunks) ? p.totalChunks : null;
    const requested =
      typeof p.chunkIndex === "number" && Number.isFinite(p.chunkIndex) ? p.chunkIndex : null;
    if (requested !== null && totalChunks !== null) {
      const maxIndex = Math.max(totalChunks - 1, 0);
      return `⚠️ Chunk ${requested} exceeds available range (max index ${maxIndex})`;
    }
    return "⚠️ Requested chunk is out of range";
  }

  const chunkIndex =
    typeof p.chunkIndex === "number" && Number.isFinite(p.chunkIndex) ? p.chunkIndex : 0;
  const totalChunks =
    typeof p.totalChunks === "number" && Number.isFinite(p.totalChunks) ? p.totalChunks : null;
  const hasMore = Boolean(p.hasMore);

  const parts: string[] = [`✅ Read "${displayName || "note"}"`];
  if (totalChunks && totalChunks > 0) {
    parts.push(`chunk ${chunkIndex + 1} of ${totalChunks}`);
  } else {
    parts.push(`chunk ${chunkIndex + 1}`);
  }
  if (hasMore) {
    parts.push("more available");
  }

  return parts.join(" · ");
}

/**
 * Format tool results for display in the UI
 * Each formatter should return a user-friendly representation of the tool result
 */
export class ToolResultFormatter {
  static format(toolName: string, result: string): string {
    try {
      // Decode tool marker encoding if present (ENC:...)
      let normalized = result;
      if (typeof normalized === "string" && normalized.startsWith("ENC:")) {
        try {
          normalized = decodeURIComponent(normalized.slice(4));
        } catch {
          // fall back to original
        }
      }

      // Try to parse as JSON for all tools now that they return JSON
      let parsedResult: unknown;
      try {
        parsedResult = JSON.parse(normalized);
      } catch {
        // If not JSON, use the raw string (for backward compatibility)
        parsedResult = normalized;
      }

      // Route to specific formatter based on tool name
      switch (toolName) {
        case "localSearch":
          return this.formatLocalSearch(parsedResult);
        case "webSearch":
          return this.formatWebSearch(parsedResult);
        case "youtubeTranscription":
          return this.formatYoutubeTranscription(parsedResult);
        case "writeFile":
          return this.formatWriteToFile(parsedResult);
        case "editFile":
          return this.formatReplaceInFile(parsedResult);
        case "readNote":
          return this.formatReadNote(parsedResult);
        default:
          // For all other tools, return the raw result
          return result;
      }
    } catch {
      // If formatting fails, return the original result
      return result;
    }
  }

  /**
   * Create a condensed summary for local search documents suitable for UI rendering.
   * @param documents Array of parsed local search documents
   * @returns Display-friendly summary string
   */
  static formatLocalSearchDocuments(documents: unknown[]): string {
    if (!Array.isArray(documents) || documents.length === 0) {
      return "📚 Found 0 relevant notes\n\nNo matching notes found.";
    }

    const total = documents.length;
    const topResults = documents.slice(0, 10);
    const hasScoringData = topResults.some((doc) => {
      const item = doc as Record<string, unknown>;
      return (
        typeof item?.rerank_score === "number" || typeof item?.score === "number" || item?.source
      );
    });

    const formattedItems = topResults
      .map((item, index) =>
        hasScoringData
          ? this.formatSearchItem(item, index)
          : this.formatBasicSearchItem(item, index)
      )
      .join("\n\n");

    const footer = total > 10 ? `\n\n... and ${total - 10} more results` : "";

    return `📚 Found ${total} relevant notes\n\nTop results:\n\n${formattedItems}${footer}`;
  }

  private static formatLocalSearch(result: unknown): string {
    // Handle XML-wrapped results from chain runners
    if (typeof result === "string") {
      // Check if it's XML-wrapped content
      const xmlMatch = result.match(/<localSearch[^>]*>([\s\S]*)<\/localSearch>/);
      if (xmlMatch) {
        // Extract the content from XML wrapper
        const xmlContent = xmlMatch[1].trim();

        // Count documents in the XML
        const documentMatches = xmlContent.match(/<document>/g);
        const count = documentMatches ? documentMatches.length : 0;

        if (count === 0) {
          return "📚 Found 0 relevant notes\n\nNo matching notes found.";
        }

        // Robustly extract document information regardless of tag ordering
        const documents: unknown[] = [];
        const blockRegex = /<document>([\s\S]*?)<\/document>/g;
        let blockMatch;
        while ((blockMatch = blockRegex.exec(xmlContent)) !== null) {
          const block = blockMatch[1];
          const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
          const pathMatch = block.match(/<path>([\s\S]*?)<\/path>/);
          const modifiedMatch = block.match(/<modified>([\s\S]*?)<\/modified>/);
          const title = (titleMatch?.[1] || "Untitled").trim();
          const path = (pathMatch?.[1] || "").trim();
          const mtime = (modifiedMatch?.[1] || "").trim();
          documents.push({ title, path, mtime: mtime || null });
        }
        return this.formatLocalSearchDocuments(documents);
      }
    }

    // Fall back to original JSON parsing logic
    const searchResults = this.parseSearchResults(result);

    if (!Array.isArray(searchResults)) {
      return typeof result === "string" ? result : JSON.stringify(result, null, 2);
    }
    if (searchResults.length === 0) {
      if (
        typeof result === "string" &&
        !result.includes("<localSearch") &&
        !result.includes('"type":"local_search"')
      ) {
        return result;
      }
      return "📚 Found 0 relevant notes\n\nNo matching notes found.";
    }
    return this.formatLocalSearchDocuments(searchResults);
  }

  private static parseSearchResults(result: unknown): unknown[] {
    // Only support the new structured format or pre-formatted XML flow
    if (typeof result === "object" && result !== null) {
      const r = result as Record<string, unknown>;
      if (r.type === "local_search" && Array.isArray(r.documents)) {
        return r.documents as unknown[];
      }
      return [];
    }
    if (typeof result === "string") {
      // Allow parsing of structured JSON string
      try {
        const parsed = JSON.parse(result) as unknown;
        if (
          parsed &&
          typeof parsed === "object" &&
          (parsed as Record<string, unknown>).type === "local_search" &&
          Array.isArray((parsed as Record<string, unknown>).documents)
        ) {
          return (parsed as Record<string, unknown>).documents as unknown[];
        }
      } catch {
        // ignore JSON parse errors; fall through to empty array
      }
      return [];
    }
    return [];
  }

  private static formatSearchItem(item: unknown, index: number): string {
    const it = item as Record<string, unknown>;
    const pathStr = typeof it.path === "string" ? it.path : "";
    const titleStr = typeof it.title === "string" ? it.title : "";
    const filename = pathStr
      ? pathStr.split("/").pop()?.replace(/\.md$/, "") || titleStr || "Untitled"
      : titleStr || "Untitled";
    const score = (it.rerank_score as number) || (it.score as number) || 0;
    const scoreDisplay = typeof score === "number" ? score.toFixed(4) : score;

    // For time-filtered results, show as "Recency" instead of "Relevance"
    const scoreLabel = it.source === "time-filtered" ? "Recency" : "Relevance";

    const lines = [`${index + 1}. ${filename}`];

    // For time-filtered queries, show actual modified time instead of a recency score
    if (it.source === "time-filtered") {
      if (it.mtime) {
        try {
          const mtimeVal = it.mtime as string | number | Date;
          const d = new Date(mtimeVal);
          const iso = isNaN(d.getTime())
            ? typeof mtimeVal === "string" || typeof mtimeVal === "number"
              ? String(mtimeVal)
              : ""
            : d.toISOString();
          lines.push(`   🕒 Modified: ${iso}${it.includeInContext ? " ✓" : ""}`);
        } catch {
          const mtimeStr =
            typeof it.mtime === "string" || typeof it.mtime === "number" ? String(it.mtime) : "";
          lines.push(`   🕒 Modified: ${mtimeStr}${it.includeInContext ? " ✓" : ""}`);
        }
      }
    } else if (it.source === "title-match") {
      // For title matches, avoid misleading numeric scores; mark as a title match
      lines.push(`   🔖 Title match${it.includeInContext ? " ✓" : ""}`);
    } else {
      // Default: show relevance-like score line
      lines.push(`   📊 ${scoreLabel}: ${scoreDisplay}${it.includeInContext ? " ✓" : ""}`);
    }

    const snippet = this.extractContentSnippet(it.content as string);
    if (snippet) {
      const contentLength = typeof it.content === "string" ? it.content.length : 0;
      lines.push(`   💬 "${snippet}${contentLength > 150 ? "..." : ""}"`);
    }

    if (pathStr && !pathStr.endsWith(`/${filename}.md`)) {
      lines.push(`   📁 ${pathStr}`);
    }

    return lines.join("\n");
  }

  private static formatBasicSearchItem(item: unknown, index: number): string {
    const it = item as Record<string, unknown>;
    const title = (it.title as string) || (it.path as string) || `Result ${index + 1}`;
    const lines = [`${index + 1}. ${title}`];

    const modified = it.mtime || it.modified || it.modified_at || it.updated_at;
    if (modified) {
      const modifiedStr =
        typeof modified === "string" || typeof modified === "number" ? String(modified) : "";
      if (modifiedStr) {
        lines.push(`   🕒 Modified: ${modifiedStr}`);
      }
    }

    if (typeof it.path === "string" && it.path && it.path !== title) {
      lines.push(`   📁 ${it.path}`);
    }

    return lines.join("\n");
  }

  private static extractContentSnippet(content: string, maxLength = 150): string {
    if (!content) return "";

    // Try to extract content after NOTE BLOCK CONTENT: pattern
    const contentMatch = content.match(/NOTE BLOCK CONTENT:\s*([\s\S]*)/);
    const cleanContent = contentMatch?.[1] || content;

    return cleanContent.substring(0, maxLength).replace(/\s+/g, " ").trim();
  }

  private static formatWebSearch(result: unknown): string {
    // Handle new JSON array format from webSearch tool
    const firstItem =
      Array.isArray(result) && result.length > 0 ? (result[0] as Record<string, unknown>) : null;
    if (firstItem && firstItem.type === "web_search") {
      const output: string[] = ["🌐 Web Search Results"];

      // Add the main content
      if (firstItem.content) {
        output.push("");
        output.push(typeof firstItem.content === "string" ? firstItem.content : "");
      }

      // Add citations if present
      const citations = Array.isArray(firstItem.citations) ? firstItem.citations : [];
      if (citations.length > 0) {
        output.push("");
        output.push("Sources:");
        citations.forEach((url: unknown, index: number) => {
          output.push(`[${index + 1}] ${String(url)}`);
        });
      }

      // Add instruction for the model
      if (firstItem.instruction) {
        output.push("");
        output.push(
          `Note: ${typeof firstItem.instruction === "string" ? firstItem.instruction : ""}`
        );
      }

      return output.join("\n");
    }

    // Fallback for old string format (for backward compatibility)
    if (typeof result === "string") {
      // Web search results include instructions and citations
      // Extract the main content and citations
      const lines = result.split("\n");
      const output: string[] = ["🌐 Web Search Results"];

      let inSources = false;
      const mainContent: string[] = [];
      const sources: string[] = [];

      for (const line of lines) {
        if (line.includes("Sources:")) {
          inSources = true;
          continue;
        }

        if (inSources) {
          sources.push(line);
        } else if (!line.includes("Here are the web search results")) {
          mainContent.push(line);
        }
      }

      // Add main content
      if (mainContent.length > 0) {
        output.push("");
        output.push(...mainContent.filter((line) => line.trim()));
      }

      // Add sources
      if (sources.length > 0) {
        output.push("");
        output.push("Sources:");
        sources.forEach((source) => {
          if (source.trim()) {
            output.push(source);
          }
        });
      }

      return output.join("\n");
    }

    return typeof result === "string" ? result : "";
  }

  private static formatYoutubeTranscription(result: unknown): string {
    // Handle both string and object results
    let parsed: unknown;

    if (typeof result === "string") {
      try {
        parsed = JSON.parse(result);
      } catch {
        // If not JSON, return as is
        return result;
      }
    } else if (typeof result === "object") {
      parsed = result;
    } else {
      return typeof result === "number" || typeof result === "boolean" ? String(result) : "";
    }

    // Narrow parsed to a record for member access
    const p =
      typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
    if (!p) {
      return typeof result === "object" ? JSON.stringify(result, null, 2) : "";
    }

    // Handle error case
    if (p.success === false) {
      return `📺 YouTube Transcription Failed\n\n${typeof p.message === "string" ? p.message : ""}`;
    }

    // Handle new multi-URL format
    if (p.results && Array.isArray(p.results)) {
      const totalUrls = typeof p.total_urls === "number" ? p.total_urls : p.results.length;
      const output: string[] = [
        `📺 YouTube Transcripts (${totalUrls} video${totalUrls > 1 ? "s" : ""})`,
      ];
      output.push("");

      for (const videoResult of p.results) {
        const vr =
          typeof videoResult === "object" && videoResult !== null
            ? (videoResult as Record<string, unknown>)
            : null;
        if (!vr) continue;
        if (vr.success) {
          output.push(`📹 Video: ${typeof vr.url === "string" ? vr.url : ""}`);
          output.push("");

          // Format transcript
          const transcript = typeof vr.transcript === "string" ? vr.transcript : "";
          const lines = transcript.split("\n");
          let formattedLines = 0;

          for (const line of lines) {
            if (line.trim()) {
              // Check if line starts with a timestamp pattern [MM:SS]
              const timestampMatch = line.match(/^\[(\d+:\d+)\]/);
              if (timestampMatch) {
                if (formattedLines > 0) output.push(""); // Add spacing
                output.push(`⏰ ${line}`);
              } else {
                output.push(`   ${line.trim()}`);
              }
              formattedLines++;

              // Limit output to prevent overwhelming display
              if (formattedLines > 30) {
                output.push("");
                output.push("... (transcript truncated for display)");
                break;
              }
            }
          }

          if (vr.elapsed_time_ms) {
            output.push("");
            output.push(
              `Processing time: ${(typeof vr.elapsed_time_ms === "number" ? vr.elapsed_time_ms / 1000 : 0).toFixed(1)}s`
            );
          }
        } else {
          output.push(`❌ Failed to transcribe: ${typeof vr.url === "string" ? vr.url : ""}`);
          output.push(`   ${typeof vr.message === "string" ? vr.message : ""}`);
        }

        output.push("");
        output.push("---");
        output.push("");
      }

      return output.join("\n").trimEnd();
    }

    // Handle old single-video format
    if (p.transcript) {
      const output: string[] = ["📺 YouTube Transcript"];
      output.push("");

      // Split transcript into manageable chunks
      const transcript = typeof p.transcript === "string" ? p.transcript : "";
      const lines = transcript.split("\n");
      let formattedLines = 0;

      for (const line of lines) {
        if (line.trim()) {
          // Check if line starts with a timestamp pattern [MM:SS]
          const timestampMatch = line.match(/^\[(\d+:\d+)\]/);
          if (timestampMatch) {
            if (formattedLines > 0) output.push(""); // Add spacing
            output.push(`⏰ ${line}`);
          } else {
            output.push(`   ${line.trim()}`);
          }
          formattedLines++;

          // Limit output to prevent overwhelming display
          if (formattedLines > 50) {
            output.push("");
            output.push("... (transcript truncated for display)");
            break;
          }
        }
      }

      if (p.elapsed_time_ms) {
        output.push("");
        output.push(
          `Processing time: ${(typeof p.elapsed_time_ms === "number" ? p.elapsed_time_ms / 1000 : 0).toFixed(1)}s`
        );
      }

      return output.join("\n");
    }

    // If we can't format it, return as string
    return typeof result === "object" ? JSON.stringify(result, null, 2) : "";
  }

  private static formatWriteToFile(result: unknown): string {
    // Extract result status from object or use string directly
    const r =
      typeof result === "object" && result !== null ? (result as Record<string, unknown>) : null;
    const status = r ? r.result : result;
    const statusStr = (
      typeof status === "string"
        ? status
        : typeof status === "number" || typeof status === "boolean"
          ? String(status)
          : ""
    ).toLowerCase();

    if (statusStr.includes("accepted")) {
      return "✅ File change: accepted";
    } else if (statusStr.includes("rejected")) {
      return "❌ File change: rejected";
    }

    // Return message if available, otherwise the raw result
    return r && typeof r.message === "string"
      ? r.message
      : typeof status === "string"
        ? status
        : "";
  }

  private static formatReplaceInFile(result: unknown): string {
    const r =
      typeof result === "object" && result !== null ? (result as Record<string, unknown>) : null;
    const rResult = r ? r.result : undefined;
    const status = r
      ? typeof rResult === "string" || typeof rResult === "number" || typeof rResult === "boolean"
        ? String(rResult)
        : ""
      : typeof result === "string"
        ? result
        : "";
    const diff = r ? r.diff : undefined;
    const diffStr = typeof diff === "string" ? diff : typeof diff === "number" ? String(diff) : "";

    if (status.toLowerCase().includes("accepted") && diffStr) {
      return `✅ Edit accepted\n\`\`\`diff\n${diffStr}\n\`\`\``;
    } else if (status.toLowerCase().includes("accepted")) {
      return "✅ Edit accepted";
    } else if (status.toLowerCase().includes("rejected")) {
      return "❌ Edit rejected";
    }

    // Error / not-found strings pass through unchanged
    return r && typeof r.message === "string" ? r.message : status;
  }

  private static formatReadNote(result: unknown): string {
    let payload: unknown = result;
    if (typeof result === "string") {
      try {
        payload = JSON.parse(result);
      } catch {
        payload = null;
      }
    }

    const summary = summarizeReadNotePayload(payload);
    if (summary) {
      return summary;
    }

    return typeof result === "string" ? result : JSON.stringify(result, null, 2);
  }
}
