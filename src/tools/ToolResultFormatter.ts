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
      // Try to parse the result as JSON first
      let parsedResult: any;
      try {
        parsedResult = JSON.parse(result);
      } catch {
        // If not JSON, use the raw string
        parsedResult = result;
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
    // If already formatted or not a string, return as is
    if (typeof result !== "string") {
      return typeof result === "object" ? JSON.stringify(result, null, 2) : String(result);
    }

    // Check if it looks like JSON (array or object)
    const trimmedResult = result.trim();
    if (!trimmedResult.startsWith("[") && !trimmedResult.startsWith("{")) {
      return result;
    }

    // Try standard JSON parsing first
    let searchResults = this.tryParseJson(result);

    // If parsing failed, try regex extraction for malformed JSON
    try {
      if (searchResults.length === 0) {
        // Match individual JSON objects (works for arrays or malformed JSON)
        const objectRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
        const matches = result.match(objectRegex);

        if (matches) {
          const regexResults: any[] = [];
          for (const match of matches) {
            try {
              // Parse each object individually
              const obj = JSON.parse(match);
              regexResults.push(obj);
            } catch {
              // Skip malformed objects
            }
          }
          searchResults = regexResults;
        }
      }

      if (searchResults.length === 0) {
        // Fallback: try to extract key information using regex
        const titleRegex = /"title"\s*:\s*"([^"]+)"/g;
        const pathRegex = /"path"\s*:\s*"([^"]+)"/g;
        const scoreRegex = /"score"\s*:\s*([\d.]+)/g;

        let titleMatch;
        const results = [];
        while ((titleMatch = titleRegex.exec(result))) {
          const title = titleMatch[1];
          pathRegex.lastIndex = titleMatch.index;
          const pathMatch = pathRegex.exec(result);
          scoreRegex.lastIndex = titleMatch.index;
          const scoreMatch = scoreRegex.exec(result);

          results.push({
            title: title,
            path: pathMatch ? pathMatch[1] : "",
            score: scoreMatch ? parseFloat(scoreMatch[1]) : 0,
            content: "", // Content is too complex to extract reliably
          });
        }

        if (results.length > 0) {
          searchResults = results;
        }
      }
    } catch {
      // If extraction fails, return original
      return result;
    }

    // Check if it's an array of search results
    if (Array.isArray(searchResults)) {
      const output: string[] = [`📚 Found ${searchResults.length} relevant notes`];

      if (searchResults.length === 0) {
        output.push("\nNo matching notes found.");
        return output.join("");
      }

      output.push("");
      output.push("Top results:");
      output.push("");

      // Show top 10 results
      searchResults.slice(0, 10).forEach((item, index) => {
        const filename =
          item.path?.split("/").pop()?.replace(/\.md$/, "") || item.title || "Untitled";
        const score = item.rerank_score || item.score || 0;
        const scoreDisplay = typeof score === "number" ? score.toFixed(3) : score;

        output.push(`${index + 1}. ${filename}`);
        output.push(`   📊 Relevance: ${scoreDisplay}${item.includeInContext ? " ✓" : ""}`);

        // Show a snippet of content if available
        if (item.content) {
          // Extract actual content from the formatted string
          let cleanContent = item.content;

          // Remove NOTE TITLE section
          cleanContent = cleanContent.replace(
            /NOTE TITLE:[\s\S]*?(?=METADATA:|NOTE BLOCK CONTENT:)/,
            ""
          );

          // Remove METADATA section
          cleanContent = cleanContent.replace(/METADATA:\{[\s\S]*?\}/, "");

          // Extract content after NOTE BLOCK CONTENT:
          const contentMatch = cleanContent.match(/NOTE BLOCK CONTENT:\s*([\s\S]*)/);
          if (contentMatch) {
            cleanContent = contentMatch[1];
          }

          // Clean up the content
          const snippet = cleanContent
            .substring(0, 150)
            .replace(/\n+/g, " ")
            .replace(/\s+/g, " ")
            .trim();

          if (snippet) {
            output.push(`   💬 "${snippet}${cleanContent.length > 150 ? "..." : ""}"`);
          }
        }

        // Show path if different from filename
        if (item.path && !item.path.endsWith(`/${filename}.md`)) {
          output.push(`   📁 ${item.path}`);
        }

        output.push("");
      });

      if (searchResults.length > 10) {
        output.push(`... and ${searchResults.length - 10} more results`);
      }

      return output.join("\n");
    }

    // If not an array, return original
    return typeof result === "string" ? result : JSON.stringify(result, null, 2);
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
