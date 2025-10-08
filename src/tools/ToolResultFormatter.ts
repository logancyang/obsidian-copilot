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
      let parsedResult: any;
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
        case "simpleYoutubeTranscriptionTool":
        case "youtubeTranscription":
          return this.formatYoutubeTranscription(parsedResult);
        case "writeToFile":
          return this.formatWriteToFile(parsedResult);
        case "replaceInFile":
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
  static formatLocalSearchDocuments(documents: any[]): string {
    if (!Array.isArray(documents) || documents.length === 0) {
      return "📚 Found 0 relevant notes\n\nNo matching notes found.";
    }

    const total = documents.length;
    const topResults = documents.slice(0, 10);
    const hasScoringData = topResults.some(
      (item) =>
        typeof item?.rerank_score === "number" || typeof item?.score === "number" || item?.source
    );

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

  private static formatLocalSearch(result: any): string {
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
        const documents: any[] = [];
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

  private static parseSearchResults(result: any): any[] {
    // Only support the new structured format or pre-formatted XML flow
    if (typeof result === "object" && result !== null) {
      if ((result as any).type === "local_search" && Array.isArray((result as any).documents)) {
        return (result as any).documents;
      }
      return [];
    }
    if (typeof result === "string") {
      // Allow parsing of structured JSON string
      try {
        const parsed = JSON.parse(result);
        if (parsed && parsed.type === "local_search" && Array.isArray(parsed.documents)) {
          return parsed.documents;
        }
      } catch {
        // ignore JSON parse errors; fall through to empty array
      }
      return [];
    }
    return [];
  }

  private static formatSearchItem(item: any, index: number): string {
    const filename = item.path?.split("/").pop()?.replace(/\.md$/, "") || item.title || "Untitled";
    const score = item.rerank_score || item.score || 0;
    const scoreDisplay = typeof score === "number" ? score.toFixed(4) : score;

    // For time-filtered results, show as "Recency" instead of "Relevance"
    const scoreLabel = item.source === "time-filtered" ? "Recency" : "Relevance";

    const lines = [`${index + 1}. ${filename}`];

    // For time-filtered queries, show actual modified time instead of a recency score
    if (item.source === "time-filtered") {
      if (item.mtime) {
        try {
          const d = new Date(item.mtime);
          const iso = isNaN(d.getTime()) ? String(item.mtime) : d.toISOString();
          lines.push(`   🕒 Modified: ${iso}${item.includeInContext ? " ✓" : ""}`);
        } catch {
          lines.push(`   🕒 Modified: ${String(item.mtime)}${item.includeInContext ? " ✓" : ""}`);
        }
      }
    } else if (item.source === "title-match") {
      // For title matches, avoid misleading numeric scores; mark as a title match
      lines.push(`   🔖 Title match${item.includeInContext ? " ✓" : ""}`);
    } else {
      // Default: show relevance-like score line
      lines.push(`   📊 ${scoreLabel}: ${scoreDisplay}${item.includeInContext ? " ✓" : ""}`);
    }

    const snippet = this.extractContentSnippet(item.content);
    if (snippet) {
      lines.push(`   💬 "${snippet}${item.content?.length > 150 ? "..." : ""}"`);
    }

    if (item.path && !item.path.endsWith(`/${filename}.md`)) {
      lines.push(`   📁 ${item.path}`);
    }

    return lines.join("\n");
  }

  private static formatBasicSearchItem(item: any, index: number): string {
    const title = item.title || item.path || `Result ${index + 1}`;
    const lines = [`${index + 1}. ${title}`];

    const modified = item.mtime || item.modified || item.modified_at || item.updated_at;
    if (modified) {
      lines.push(`   🕒 Modified: ${String(modified)}`);
    }

    if (item.path && item.path !== title) {
      lines.push(`   📁 ${item.path}`);
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

  private static formatWebSearch(result: any): string {
    // Handle new JSON array format from webSearch tool
    if (Array.isArray(result) && result.length > 0 && result[0].type === "web_search") {
      const output: string[] = ["🌐 Web Search Results"];
      const item = result[0];

      // Add the main content
      if (item.content) {
        output.push("");
        output.push(item.content);
      }

      // Add citations if present
      if (item.citations && item.citations.length > 0) {
        output.push("");
        output.push("Sources:");
        item.citations.forEach((url: string, index: number) => {
          output.push(`[${index + 1}] ${url}`);
        });
      }

      // Add instruction for the model
      if (item.instruction) {
        output.push("");
        output.push(`Note: ${item.instruction}`);
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

    return result;
  }

  private static formatYoutubeTranscription(result: any): string {
    // Handle both string and object results
    let parsed: any;

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
      return String(result);
    }

    // Handle error case
    if (parsed.success === false) {
      return `📺 YouTube Transcription Failed\n\n${parsed.message}`;
    }

    // Handle new multi-URL format
    if (parsed.results && Array.isArray(parsed.results)) {
      const output: string[] = [
        `📺 YouTube Transcripts (${parsed.total_urls} video${parsed.total_urls > 1 ? "s" : ""})`,
      ];
      output.push("");

      for (const videoResult of parsed.results) {
        if (videoResult.success) {
          output.push(`📹 Video: ${videoResult.url}`);
          output.push("");

          // Format transcript
          const lines = videoResult.transcript.split("\n");
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

          if (videoResult.elapsed_time_ms) {
            output.push("");
            output.push(`Processing time: ${(videoResult.elapsed_time_ms / 1000).toFixed(1)}s`);
          }
        } else {
          output.push(`❌ Failed to transcribe: ${videoResult.url}`);
          output.push(`   ${videoResult.message}`);
        }

        output.push("");
        output.push("---");
        output.push("");
      }

      return output.join("\n").trimEnd();
    }

    // Handle old single-video format
    if (parsed.transcript) {
      const output: string[] = ["📺 YouTube Transcript"];
      output.push("");

      // Split transcript into manageable chunks
      const lines = parsed.transcript.split("\n");
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

      if (parsed.elapsed_time_ms) {
        output.push("");
        output.push(`Processing time: ${(parsed.elapsed_time_ms / 1000).toFixed(1)}s`);
      }

      return output.join("\n");
    }

    // If we can't format it, return as string
    return typeof result === "object" ? JSON.stringify(result, null, 2) : String(result);
  }

  private static formatWriteToFile(result: any): string {
    // Extract result status from object or use string directly
    const status = typeof result === "object" ? result.result : result;
    const statusStr = String(status).toLowerCase();

    if (statusStr.includes("accepted")) {
      return "✅ File change: accepted";
    } else if (statusStr.includes("rejected")) {
      return "❌ File change: rejected";
    }

    // Return message if available, otherwise the raw result
    return typeof result === "object" && result.message ? result.message : String(status);
  }

  private static formatReplaceInFile(result: any): string {
    // Extract block count from object or string
    let blockCount = 0;
    let status = "";

    if (typeof result === "object") {
      blockCount = result.blocksApplied || 0;
      status = result.result || "";
    } else if (typeof result === "string") {
      const match = result.match(/Applied (\d+) SEARCH\/REPLACE block/);
      if (match) blockCount = parseInt(match[1]);
      status = result;
    }

    const statusStr = String(status).toLowerCase();

    if (statusStr.includes("accepted")) {
      const replacementText = blockCount === 1 ? "replacement" : "replacements";
      return blockCount > 0
        ? `✅ ${blockCount} ${replacementText} accepted`
        : "✅ File replacements: accepted";
    } else if (statusStr.includes("rejected")) {
      return blockCount === 0 ? "❌ No replacements made" : "❌ File replacements: rejected";
    }

    // Return message if available, otherwise the raw result
    return typeof result === "object" && result.message ? result.message : String(status);
  }

  private static formatReadNote(result: any): string {
    const data =
      typeof result === "object" && result !== null
        ? result
        : (() => {
            try {
              return JSON.parse(String(result));
            } catch {
              return null;
            }
          })();

    if (!data || typeof data !== "object") {
      return typeof result === "string" ? result : JSON.stringify(result, null, 2);
    }

    const status = typeof data.status === "string" ? data.status : null;
    const message = typeof data.message === "string" ? data.message : null;
    const candidates = Array.isArray(data.candidates) ? data.candidates : null;

    if (status === "not_found") {
      const baseLines = ["⚠️ Note not found"];
      if (message) {
        baseLines.push("");
        baseLines.push(message);
      }
      return baseLines.join("\n");
    }

    if (status === "not_unique") {
      const baseLines = ["⚠️ Multiple notes match that title"];
      if (message) {
        baseLines.push("");
        baseLines.push(message);
      }
      if (candidates && candidates.length > 0) {
        baseLines.push("");
        baseLines.push("Candidates:");
        for (const candidate of candidates) {
          const path = typeof candidate?.path === "string" ? candidate.path : "";
          const title =
            typeof candidate?.title === "string" ? candidate.title : path || "(unknown)";
          baseLines.push(`- ${title}${path && path !== title ? ` (${path})` : ""}`);
        }
      }
      return baseLines.join("\n");
    }

    const notePath = data.notePath ?? "";
    const title = data.noteTitle ?? deriveReadNoteDisplayName(notePath);
    const chunkIndex = typeof data.chunkIndex === "number" ? data.chunkIndex : 0;
    const totalChunks = typeof data.totalChunks === "number" ? data.totalChunks : undefined;
    const heading =
      typeof data.heading === "string" && data.heading.trim().length > 0 ? data.heading.trim() : "";
    const hasMore = Boolean(data.hasMore);
    const nextChunk = typeof data.nextChunkIndex === "number" ? data.nextChunkIndex : null;
    const content = typeof data.content === "string" ? data.content.trim() : "";

    const lines: string[] = [];
    lines.push(`📄 ${title}`);
    if (notePath) {
      lines.push(`   Path: ${notePath}`);
    }
    const chunkLabel = totalChunks
      ? `Chunk ${chunkIndex + 1} of ${totalChunks}`
      : `Chunk ${chunkIndex + 1}`;
    lines.push(`   ${chunkLabel}${hasMore ? " · more available" : ""}`);
    if (nextChunk !== null) {
      lines.push(`   Next chunk index: ${nextChunk}`);
    }
    if (heading) {
      lines.push(`   Heading: ${heading}`);
    }

    lines.push("");

    if (content) {
      const MAX_PREVIEW = 800;
      const preview = content.length > MAX_PREVIEW ? `${content.slice(0, MAX_PREVIEW)}…` : content;
      lines.push(preview);
      if (content.length > MAX_PREVIEW) {
        lines.push("");
        lines.push("… (truncated for display)");
      }
    } else {
      lines.push("(This chunk is empty.)");
    }

    return lines.join("\n");
  }
}
