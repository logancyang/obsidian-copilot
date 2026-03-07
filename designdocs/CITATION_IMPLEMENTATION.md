# Inline Citation System

This guide explains how inline citations are produced across Copilot Plus, Vault QA, and web search, and how the feature is exercised by automated tests.

## Feature Toggle & Surface Area

- `enableInlineCitations` (default `true`) lives in `src/settings/model.ts` and is exposed in the QA settings UI (`src/settings/v2/components/QASettings.tsx`).
- The toggle gates prompt instructions, fallback post-processing, and chat rendering. When disabled the system falls back to a collapsible sources list without inline markers.

## Pipeline Overview

1. **Retrieval Conditioning**
   - Both `CopilotPlusChainRunner.prepareLocalSearchResult` and `VaultQAChainRunner` sanitize note content with `sanitizeContentForCitations` to strip stray `[^n]`/`[n]` markers before prompting.
   - Retrieved notes receive stable `__sourceId` values and are serialized with `formatSearchResultsForLLM`; `deduplicateSources` keeps the highest-scoring entry per path/title.
   - A compact source catalog is built via `formatSourceCatalog`, and Copilot Plus caches the first 20 entries in `lastCitationSources` for fallback footnotes.
2. **Prompt Assembly**
   - `CITATION_RULES` and `WEB_CITATION_RULES` live in `src/LLMProviders/chainRunner/utils/citationUtils.ts`.
   - `getCitationInstructions` (Copilot Plus) and `getQACitationInstructionsConditional` (Vault QA) append guidance and a source catalog only when inline citations are enabled.
   - Web search calls `getWebSearchCitationInstructions` so external sources emit `[title](url)` definitions while vault answers stay on `[[Note]]` links.
3. **Response Safeguards**
   - `addFallbackSources` appends a `#### Sources` block when the model produced inline markers but no definitions. Detection relies on `hasExistingCitations`, which now accepts alternate headings (e.g., `## Sources`, `Sources -`) and `<summary>Sources</summary>` blocks.
   - Copilot Plus passes structured `lastCitationSources` into the fallback helper; Vault QA derives titles from the retriever output.
4. **Chat Rendering**
   - `src/components/chat-components/ChatSingleMessage.tsx` always pipes assistant messages through `processInlineCitations`.
   - The helper extracts the trailing sources section, builds a first-mention map with `buildCitationMap`, normalizes references (`normalizeCitations`) so constructs like `[^7][^8]` become `[1][2]`, and converts definitions (`convertFootnoteDefinitions`) into clickable wiki links or Markdown anchors.
   - Duplicate definitions collapse via `consolidateDuplicateSources` + `updateCitationsForConsolidation`, keeping numbering stable. When the sources block is not footnote formatted or citations are disabled, the renderer falls back to a simple `<details>` list.

## Testing

- `src/LLMProviders/chainRunner/utils/citationUtils.test.ts`
  - Sanitization, catalog formatting, and fallback insertion.
  - `hasExistingCitations` coverage for markdown headings, plain `Sources` labels, and `<summary>` wrappers.
  - Regression suites for non-sequential citations, duplicate source consolidation, and consecutive markers (`[^7][^8]`).
- `src/LLMProviders/chainRunner/utils/searchResultUtils.test.ts`
  - Ensures retrieved documents are serialized with stable IDs and filtered for `includeInContext` before prompting.
- `src/tools/ToolResultFormatter.test.ts`
  - Verifies the local search tool emits JSON with the `{ type: "local_search", documents: [...] }` shape expected by the chain runners.

## Manual QA Checklist

- Vault QA turn using only local search: confirm inline `[1]` markers and numbered sources render without duplication.
- Mixed Copilot Plus turn (local search + another tool): ensure fallback still works if the model omits the sources block.
- Web search answer: verify footnote definitions render as `[title](url)` links when citations are enabled.

## Watchlist

- `sanitizeContentForCitations` intentionally strips bracketed numbers; keep an eye on domains (math, law) where literal `[1990]` values might be desirable.
- Inline citations remain model-dependent. `addFallbackSources` guarantees a sources list, but the UI still reflects whatever inline markers the provider returns.
