import { logWarn } from "@/logger";

/**
 * Format tool results for display in the UI
 * Each formatter should return a user-friendly representation of the tool result
 */
export class ToolResultFormatter {
  /**
   * Try to parse JSON string, returns array of parsed objects
   * @param json JSON string to parse
   * @returns Array containing parsed object(s), or empty array if parsing fails
   */
  private static tryParseJson(json: string): any[] {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  }
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

      // Try to parse the (potentially decoded) result as JSON first
      let parsedResult: any;
      try {
        parsedResult = JSON.parse(normalized);
      } catch (e) {
        // If not JSON, use the raw string
        logWarn(`ToolResultFormatter: Failed to parse JSON for ${toolName}:`, e);
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
        default:
          // For all other tools, return the raw result
          return result;
      }
    } catch {
      // If formatting fails, return the original result
      return result;
    }
  }

  private static formatLocalSearch(result: any): string {
    const searchResults = this.parseSearchResults(result);

    if (!Array.isArray(searchResults)) {
      return typeof result === "string" ? result : JSON.stringify(result, null, 2);
    }

    const count = searchResults.length;
    if (count === 0) {
      return "📚 Found 0 relevant notes\n\nNo matching notes found.";
    }

    const topResults = searchResults.slice(0, 10);
    const formattedItems = topResults
      .map((item, index) => this.formatSearchItem(item, index))
      .join("\n\n");

    const footer = count > 10 ? `\n\n... and ${count - 10} more results` : "";

    return `📚 Found ${count} relevant notes\n\nTop results:\n\n${formattedItems}${footer}`;
  }

  private static parseSearchResults(result: any): any[] {
    if (Array.isArray(result)) return result;
    if (typeof result === "object" && result !== null) return [result];
    if (typeof result === "string") {
      const trimmed = result.trim();
      if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
        return [];
      }
      return this.tryParseJson(result);
    }
    return [];
  }

  private static formatSearchItem(item: any, index: number): string {
    const filename = item.path?.split("/").pop()?.replace(/\.md$/, "") || item.title || "Untitled";
    const score = item.rerank_score || item.score || 0;
    const scoreDisplay = typeof score === "number" ? score.toFixed(3) : score;

    // For time-filtered results, show as "Recency" instead of "Relevance"
    const scoreLabel = item.source === "time-filtered" ? "Recency" : "Relevance";

    const lines = [
      `${index + 1}. ${filename}`,
      `   📊 ${scoreLabel}: ${scoreDisplay}${item.includeInContext ? " ✓" : ""}`,
    ];

    const snippet = this.extractContentSnippet(item.content);
    if (snippet) {
      lines.push(`   💬 "${snippet}${item.content?.length > 150 ? "..." : ""}"`);
    }

    if (item.path && !item.path.endsWith(`/${filename}.md`)) {
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
    if (typeof result === "string") {
      // Check if it contains "accepted" or "rejected"
      if (result.toLowerCase().includes("accepted")) {
        return "✅ File change: accepted";
      } else if (result.toLowerCase().includes("rejected")) {
        return "❌ File change: rejected";
      }

      // Fallback for other messages
      return result;
    }
    return result;
  }

  private static formatReplaceInFile(result: any): string {
    if (typeof result === "string") {
      // Extract the number of replacements from the result
      const blockMatch = result.match(/Applied (\d+) SEARCH\/REPLACE block\(s\)/);
      if (blockMatch) {
        const blockCount = blockMatch[1];
        const replacementText = blockCount === "1" ? "replacement" : "replacements";

        if (result.toLowerCase().includes("accepted")) {
          return `✅ ${blockCount} ${replacementText} accepted`;
        }
      }

      // Check if it contains "accepted" or "rejected"
      if (result.toLowerCase().includes("accepted")) {
        return "✅ File replacements: accepted";
      } else if (result.toLowerCase().includes("rejected")) {
        return "❌ File replacements: rejected";
      }

      // Fallback for other messages
      return result;
    }
    return result;
  }
}
