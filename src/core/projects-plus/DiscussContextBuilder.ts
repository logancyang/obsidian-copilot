/**
 * DiscussContextBuilder - Builds context from project notes for Discuss conversations
 *
 * Uses scoped semantic + lexical search within project notes only.
 * Follows NoteAssignmentService patterns for search.
 */

import { logError, logInfo, logWarn } from "@/logger";
import { buildDiscussSystemPrompt } from "@/prompts/discuss-system";
import { MergedSemanticRetriever } from "@/search/v3/MergedSemanticRetriever";
import { DiscussContext, ScopedSearchOptions } from "@/types/discuss";
import { Project } from "@/types/projects-plus";
import { Document } from "@langchain/core/documents";
import { App, TFile, Vault } from "obsidian";

/**
 * Default options for scoped search
 */
const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_MIN_SCORE = 0.3;

/**
 * DiscussContextBuilder - Builds LLM context from project notes
 *
 * Orchestrates:
 * 1. Scoped search within project notes
 * 2. Force-inclusion of @mentioned notes
 * 3. Note content formatting
 * 4. System prompt construction
 */
export class DiscussContextBuilder {
  constructor(
    private app: App,
    private vault: Vault
  ) {}

  /**
   * Build context for a user message in a Discuss conversation
   *
   * @param params.project - The project context
   * @param params.userMessage - User's message for semantic search
   * @param params.forcedNotes - Notes explicitly @mentioned by user
   * @param params.options - Search configuration
   * @returns Context with notes, formatted content, and system prompt
   */
  async buildContext(params: {
    project: Project;
    userMessage: string;
    forcedNotes: TFile[];
    options?: ScopedSearchOptions;
  }): Promise<DiscussContext> {
    const { project, userMessage, forcedNotes, options = {} } = params;
    const { maxResults = DEFAULT_MAX_RESULTS, minScore = DEFAULT_MIN_SCORE } = options;

    try {
      // 1. Get project note paths for scoping
      const projectNotePaths = new Set(project.notes.map((n) => n.path));

      // 2. Semantic + lexical search WITHIN project notes only
      let relevantNotes: TFile[] = [];

      if (userMessage.trim() && projectNotePaths.size > 0) {
        relevantNotes = await this.searchWithinScope(
          userMessage,
          projectNotePaths,
          maxResults,
          minScore
        );
      }

      // 3. Merge with forced notes (always included)
      const contextNotes = this.mergeAndDedupe(relevantNotes, forcedNotes);

      // 4. Load and format note contents
      const noteContents = await this.formatNoteContents(contextNotes);

      // 5. Build system prompt with project context
      const systemPrompt = buildDiscussSystemPrompt({
        projectTitle: project.title,
        projectDescription: project.description,
        successCriteria: project.successCriteria,
      });

      logInfo(
        `[DiscussContextBuilder] Built context with ${contextNotes.length} notes ` +
          `(${relevantNotes.length} from search, ${forcedNotes.length} forced)`
      );

      return {
        notes: contextNotes,
        noteContents,
        systemPrompt,
      };
    } catch (error) {
      logError("[DiscussContextBuilder] Error building context:", error);

      // Return minimal context on error
      return {
        notes: forcedNotes,
        noteContents: await this.formatNoteContents(forcedNotes),
        systemPrompt: buildDiscussSystemPrompt({
          projectTitle: project.title,
          projectDescription: project.description,
          successCriteria: project.successCriteria,
        }),
      };
    }
  }

  /**
   * Search within a scoped set of note paths
   *
   * Uses MergedSemanticRetriever but filters results to only include
   * notes that are assigned to the project.
   */
  private async searchWithinScope(
    query: string,
    scopePaths: Set<string>,
    maxResults: number,
    minScore: number
  ): Promise<TFile[]> {
    try {
      // Extract salient terms for lexical matching
      const salientTerms = query
        .split(/\s+/)
        .filter((t) => t.length > 2)
        .slice(0, 10);

      // Use MergedSemanticRetriever for hybrid search
      const retriever = new MergedSemanticRetriever(this.app, {
        maxK: maxResults * 3, // Get more to filter
        salientTerms,
        minSimilarityScore: minScore,
        returnAll: false,
      });

      const documents = await retriever.getRelevantDocuments(query);

      // Filter to only include notes within project scope
      const scopedNotes = this.filterAndAggregateToNotes(documents, scopePaths, maxResults);

      return scopedNotes;
    } catch (error) {
      logWarn("[DiscussContextBuilder] Search failed:", error);
      return [];
    }
  }

  /**
   * Filter documents to project scope and aggregate to note level
   */
  private filterAndAggregateToNotes(
    documents: Document[],
    scopePaths: Set<string>,
    maxResults: number
  ): TFile[] {
    // Map to track best score per note
    const noteScores = new Map<string, number>();

    for (const doc of documents) {
      const metadata = doc.metadata ?? {};
      const path = this.extractNotePath(metadata);

      if (!path || !scopePaths.has(path)) {
        continue; // Skip notes not in project
      }

      const score = (metadata.score as number) ?? (metadata.rerank_score as number) ?? 0;
      const existing = noteScores.get(path) ?? 0;

      if (score > existing) {
        noteScores.set(path, score);
      }
    }

    // Sort by score and get top notes
    const sortedPaths = [...noteScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxResults)
      .map(([path]) => path);

    // Convert to TFile objects
    const notes: TFile[] = [];
    for (const path of sortedPaths) {
      const file = this.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        notes.push(file);
      }
    }

    return notes;
  }

  /**
   * Extract note path from document metadata
   */
  private extractNotePath(metadata: Record<string, unknown>): string | null {
    // Try chunkId first (format: "note.md#0")
    const chunkId = metadata.chunkId as string | undefined;
    if (chunkId) {
      const hashIndex = chunkId.lastIndexOf("#");
      if (hashIndex > 0) {
        return chunkId.slice(0, hashIndex);
      }
      return chunkId;
    }

    // Fall back to path
    const path = metadata.path as string | undefined;
    if (path) {
      const hashIndex = path.lastIndexOf("#");
      if (hashIndex > 0) {
        return path.slice(0, hashIndex);
      }
      return path;
    }

    return null;
  }

  /**
   * Merge and deduplicate note arrays
   * Forced notes come first (always included), then search results
   */
  private mergeAndDedupe(searchResults: TFile[], forcedNotes: TFile[]): TFile[] {
    const seen = new Set<string>();
    const result: TFile[] = [];

    // Forced notes first (always included)
    for (const note of forcedNotes) {
      if (!seen.has(note.path)) {
        seen.add(note.path);
        result.push(note);
      }
    }

    // Then search results
    for (const note of searchResults) {
      if (!seen.has(note.path)) {
        seen.add(note.path);
        result.push(note);
      }
    }

    return result;
  }

  /**
   * Format note contents for LLM context
   */
  private async formatNoteContents(notes: TFile[]): Promise<string> {
    if (notes.length === 0) {
      return "";
    }

    const parts: string[] = [];

    for (const note of notes) {
      try {
        const content = await this.vault.read(note);

        // Strip YAML frontmatter for cleaner context
        const stripped = content.replace(/^---[\s\S]*?---\n?/, "").trim();

        parts.push(`<note title="${note.basename}" path="${note.path}">\n${stripped}\n</note>`);
      } catch (error) {
        logWarn(`[DiscussContextBuilder] Error reading note ${note.path}:`, error);
      }
    }

    return parts.join("\n\n");
  }

  /**
   * Build a summary of notes for suggested questions generation
   */
  async buildNotesSummary(notes: TFile[], maxNotes: number = 5): Promise<string> {
    const limitedNotes = notes.slice(0, maxNotes);
    const summaries: string[] = [];

    for (const note of limitedNotes) {
      try {
        const content = await this.vault.read(note);
        const stripped = content.replace(/^---[\s\S]*?---\n?/, "").trim();

        // Extract first 200 chars as summary
        const summary = stripped.slice(0, 200) + (stripped.length > 200 ? "..." : "");
        summaries.push(`**${note.basename}**: ${summary}`);
      } catch (error) {
        logWarn(`[DiscussContextBuilder] Error reading note for summary ${note.path}:`, error);
      }
    }

    return summaries.join("\n\n");
  }
}
