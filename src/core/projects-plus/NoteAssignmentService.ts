/**
 * NoteAssignmentService
 *
 * Finds relevant notes for a project using AI-powered hybrid search.
 * Orchestrates query generation, search execution, and result aggregation.
 */

import { logError, logInfo, logWarn } from "@/logger";
import { buildQueryGenerationPrompt } from "@/prompts/note-assignment";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import { MergedSemanticRetriever } from "@/search/v3/MergedSemanticRetriever";
import {
  MatchSource,
  NoteAssignmentOptions,
  NoteAssignmentResult,
  NoteSuggestion,
  Project,
} from "@/types/projects-plus";
import { Document } from "@langchain/core/documents";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { App, TFile } from "obsidian";

/**
 * Timeout for LLM query generation (in milliseconds)
 */
const LLM_TIMEOUT_MS = 10000;

/**
 * NoteAssignmentService - Finds relevant notes for a project using AI-powered search
 *
 * Orchestrates:
 * 1. Query generation from project context
 * 2. Hybrid search execution (lexical + semantic)
 * 3. Chunk-to-note aggregation
 * 4. Result filtering and formatting
 */
export class NoteAssignmentService {
  private static readonly DEFAULT_MIN_SCORE = 0.4;
  private static readonly DEFAULT_MAX_SUGGESTIONS = 50;
  private static readonly SEARCH_K_MULTIPLIER = 3;

  constructor(
    private app: App,
    private getChatModel: () => BaseChatModel | null
  ) {}

  /**
   * Find relevant notes for a project
   * @param project - The project to find notes for
   * @param options - Search configuration
   * @returns Search results with ranked suggestions
   */
  async findRelevantNotes(
    project: Project,
    options: NoteAssignmentOptions = {}
  ): Promise<NoteAssignmentResult> {
    const minScore = options.minScore ?? NoteAssignmentService.DEFAULT_MIN_SCORE;
    const maxSuggestions = options.maxSuggestions ?? NoteAssignmentService.DEFAULT_MAX_SUGGESTIONS;

    try {
      // 1. Generate search query from project context
      const generatedQuery = await this.generateSearchQuery(project);

      if (!generatedQuery.trim()) {
        return {
          suggestions: [],
          generatedQuery: "",
          totalSearched: 0,
          success: false,
          error: "Failed to generate search query from project context",
        };
      }

      logInfo("[NoteAssignmentService] Generated query:", generatedQuery);

      // 2. Execute search (get more than needed for deduplication)
      const searchK = maxSuggestions * NoteAssignmentService.SEARCH_K_MULTIPLIER;
      const suggestions = await this.executeSearchAndAggregate(generatedQuery, searchK);

      // 3. Filter by minimum score
      const filtered = suggestions.filter((s) => s.relevanceScore >= minScore);

      // 4. Exclude already-assigned notes
      const assignedPaths = new Set(project.notes.map((n) => n.path));
      const unassigned = filtered.filter((s) => !assignedPaths.has(s.path));

      // 5. Apply global exclusions (unless explicitly ignored)
      const final = options.ignoreExclusions ? unassigned : this.applyExclusions(unassigned);

      const totalSearched = this.app.vault.getMarkdownFiles().length;

      logInfo(
        `[NoteAssignmentService] Found ${final.length} relevant notes (${filtered.length} above threshold, ${suggestions.length} total)`
      );

      return {
        suggestions: final.slice(0, maxSuggestions),
        generatedQuery,
        totalSearched,
        success: true,
      };
    } catch (error) {
      logError("[NoteAssignmentService] Error finding relevant notes:", error);
      return {
        suggestions: [],
        generatedQuery: "",
        totalSearched: 0,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  /**
   * Generate an optimized search query from project context
   * @param project - The project to generate query for
   * @returns Generated search query string
   */
  async generateSearchQuery(project: Project): Promise<string> {
    const chatModel = this.getChatModel();
    if (!chatModel) {
      logWarn("[NoteAssignmentService] No chat model available, using fallback query generation");
      return this.fallbackQueryGeneration(project);
    }

    const prompt = buildQueryGenerationPrompt(
      project.title,
      project.description,
      project.successCriteria
    );

    try {
      const response = await this.withTimeout(
        async () => chatModel.invoke(prompt),
        LLM_TIMEOUT_MS,
        "Query generation"
      );

      const content = typeof response.content === "string" ? response.content.trim() : "";

      if (!content) {
        logWarn("[NoteAssignmentService] Empty LLM response, using fallback");
        return this.fallbackQueryGeneration(project);
      }

      return content;
    } catch (error) {
      logWarn("[NoteAssignmentService] Query generation failed, using fallback:", error);
      return this.fallbackQueryGeneration(project);
    }
  }

  /**
   * Fallback query generation when LLM is unavailable
   * Extracts keywords from project text
   */
  private fallbackQueryGeneration(project: Project): string {
    const text = `${project.title} ${project.description} ${project.successCriteria.join(" ")}`;
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 15);
    return [...new Set(words)].join(" ");
  }

  /**
   * Execute search and aggregate results to whole notes
   */
  private async executeSearchAndAggregate(
    query: string,
    maxResults: number
  ): Promise<NoteSuggestion[]> {
    const salientTerms = query.split(/\s+/).filter((t) => t.length > 2);

    const retriever = new MergedSemanticRetriever(this.app, {
      maxK: maxResults,
      salientTerms,
      minSimilarityScore: 0.1,
      returnAll: false,
    });

    const documents = await retriever.getRelevantDocuments(query);
    return this.aggregateToNotes(documents);
  }

  /**
   * Aggregate chunk documents to note-level suggestions
   * Uses max-score aggregation for each note
   */
  private aggregateToNotes(documents: Document[]): NoteSuggestion[] {
    // Group by note path
    const noteMap = new Map<
      string,
      {
        maxScore: number;
        bestExcerpt: string;
        tags: string[];
        mtime: number;
        sources: Set<string>;
      }
    >();

    for (const doc of documents) {
      const metadata = doc.metadata ?? {};
      // Get the note path from chunk ID or path
      const path = this.extractNotePath(metadata);
      if (!path) continue;

      const score = (metadata.score as number) ?? (metadata.rerank_score as number) ?? 0;
      const source = (metadata.source as string) ?? "lexical";
      const existing = noteMap.get(path);

      if (!existing) {
        noteMap.set(path, {
          maxScore: score,
          bestExcerpt: this.extractExcerpt(doc.pageContent),
          tags: Array.isArray(metadata.tags) ? metadata.tags : [],
          mtime: (metadata.mtime as number) ?? 0,
          sources: new Set([source]),
        });
      } else {
        if (score > existing.maxScore) {
          existing.maxScore = score;
          existing.bestExcerpt = this.extractExcerpt(doc.pageContent);
        }
        existing.sources.add(source);
      }
    }

    // Convert to NoteSuggestion array
    const suggestions: NoteSuggestion[] = [];
    for (const [path, data] of noteMap) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file || !(file instanceof TFile)) continue;

      const matchSource = this.determineMatchSource(data.sources);

      suggestions.push({
        path,
        title: file.basename,
        relevanceScore: data.maxScore,
        excerpt: data.bestExcerpt,
        tags: data.tags,
        mtime: data.mtime || file.stat.mtime,
        matchSource,
      });
    }

    // Sort by score descending
    return suggestions.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /**
   * Extract the note path from document metadata
   * Handles both chunk IDs (path#chunkIndex) and direct paths
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
      // Remove chunk suffix if present
      const hashIndex = path.lastIndexOf("#");
      if (hashIndex > 0) {
        return path.slice(0, hashIndex);
      }
      return path;
    }

    // Try id
    const id = metadata.id as string | undefined;
    if (id && id.endsWith(".md")) {
      return id;
    }

    return null;
  }

  /**
   * Determine the match source based on which retrievers found the note
   */
  private determineMatchSource(sources: Set<string>): MatchSource {
    const hasLexical = sources.has("lexical");
    const hasSemantic = sources.has("semantic");

    if (hasLexical && hasSemantic) {
      return "hybrid";
    } else if (hasSemantic) {
      return "semantic";
    }
    return "lexical";
  }

  /**
   * Extract a preview excerpt from chunk content
   */
  private extractExcerpt(content: string, maxLength: number = 150): string {
    // Strip markdown frontmatter
    const stripped = content.replace(/^---[\s\S]*?---\n?/, "");
    // Get first meaningful lines (skip headers and empty lines)
    const lines = stripped.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    const text = lines.slice(0, 3).join(" ").trim();
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + "...";
  }

  /**
   * Apply global Copilot exclusions to filter out excluded notes
   */
  private applyExclusions(suggestions: NoteSuggestion[]): NoteSuggestion[] {
    const { exclusions } = getMatchingPatterns();
    if (!exclusions) return suggestions;

    return suggestions.filter((s) => {
      const file = this.app.vault.getAbstractFileByPath(s.path);
      if (!file || !(file instanceof TFile)) return false;
      return shouldIndexFile(file, null, exclusions);
    });
  }

  /**
   * Execute a promise with timeout
   */
  private async withTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      fn()
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }
}
