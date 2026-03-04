# Vault Search and Indexing

Copilot can search your vault to find relevant notes and answer questions grounded in your own content. This guide explains the two types of search, how to manage the index, and how to configure what gets indexed.

---

## Two Types of Search

### Lexical Search (Keyword-Based)

Lexical search finds notes that contain the exact words you used. It's fast, requires no setup, and works out of the box.

- **Used in**: Vault QA (Basic) mode
- **How it works**: Looks for your exact keywords in note titles and content
- **Strengths**: Fast, precise, no embedding API calls needed
- **Limitations**: Won't find notes that use different words to express the same idea

**RAM Limit**: The lexical search index is held in memory. You can configure the memory limit in **Settings → Copilot → QA → Lexical Search RAM Limit** (default: 100 MB, range: 20–1,000 MB).

**Lexical Boosts**: Copilot can boost search results from notes in the same folder as the current note, or from notes that link to each other. Enable in **Settings → Copilot → QA → Enable Lexical Boosts** (on by default).

### Semantic Search (Meaning-Based)

Semantic search finds notes that are conceptually related, even if they don't share exact words.

- **Used in**: Copilot Plus mode, and in Vault QA when enabled
- **How it works**: Converts your notes into numerical vectors (using an embedding model), then finds notes whose vectors are closest to your query
- **Strengths**: Finds notes by concept and meaning, great for "fuzzy" recall
- **Cost**: Requires embedding API calls (costs money for paid embedding models)
- **Enable**: **Settings → Copilot → QA → Enable Semantic Search** (disabled by default)

---

## Index Management

The semantic search index stores the vector embeddings of your notes. Manage it from **Settings → Copilot → QA**.

### Auto-Index Strategy

Controls when Copilot automatically updates the index:

| Strategy | When the index updates |
|---|---|
| **NEVER** | Manual only — you must trigger indexing yourself |
| **ON STARTUP** | Updates when Obsidian starts or the plugin reloads |
| **ON MODE SWITCH** | Updates when you switch to Vault QA or Copilot Plus mode (Recommended) |

The default is **ON MODE SWITCH**.

> **Warning**: For large vaults using paid embedding models, frequent indexing can incur significant costs. Consider using NEVER and indexing manually if cost is a concern.

### Refresh Index (Incremental)

**Command palette → Index (refresh) vault**

Updates only notes that have been added, modified, or deleted since the last index. Faster and cheaper than a full reindex.

### Force Reindex

**Command palette → Force reindex vault**

Rebuilds the entire index from scratch. Use this if:
- You changed your embedding model
- The index seems corrupted or missing results
- You've made many changes and want a clean state

### Garbage Collection

**Command palette → Garbage collect Copilot index (remove files that no longer exist in vault)**

Removes entries from the index for notes that have been deleted from your vault. Keeps the index clean without a full reindex.

### Clear Index

**Command palette → Clear local Copilot index**

Deletes the entire index. You'll need to reindex before semantic search works again.

### Debug Commands

For troubleshooting:

- **List indexed files** — Shows all notes currently in the index
- **Inspect index by note paths** — Check which chunks of specific notes are indexed
- **Count total vault tokens** — Estimates total tokens across your vault
- **Search semantic index** — Run a direct search query against the index

---

## Filtering: What Gets Indexed

Control which notes are included in semantic search.

### Cost Estimation Before Indexing

Before indexing a large vault with a paid embedding model, estimate the cost first:

**Command palette → Count total tokens in your vault**

This shows the total token count across your vault, which you can use to estimate embedding API costs. Embedding costs are generally low, but worth checking for very large vaults.

### Exclusions

**Settings → Copilot → QA → Exclusions**

Comma-separated list of patterns. Notes matching these patterns are excluded. Supports:
- Folder names: `private` — excludes the folder named "private"
- Folder paths: `Work/Confidential` — excludes that specific subfolder
- File extensions: `.pdf` — excludes all PDF files
- Tags: `#private` — excludes all notes tagged `#private`
- Note titles: `My Secret Note` — excludes that specific note

Example: `private, Work/Confidential, #private` excludes the private folder, a specific work folder, and all notes tagged #private.

> **Note**: Tag matching works with tags in the note's **properties (frontmatter)**, not inline tags within the note body.

The `copilot` folder is always excluded automatically (it contains the plugin's own files).

### Inclusions

**Settings → Copilot → QA → Inclusions**

Comma-separated list. If set, **only** notes matching these patterns are indexed. Useful for indexing a specific area of your vault.

Leave empty to include everything (except exclusions).

---

## Embedding Settings

These settings appear in **Settings → Copilot → QA** when Semantic Search is enabled.

### Requests per Minute

How many embedding API requests to send per minute. Default is 60. Decrease this if you hit rate limit errors from your embedding provider.

Range: 10–60

### Embedding Batch Size

How many text chunks to send per API request. Default is 16. Larger batches are faster but may cause issues with some providers.

### Partitions

The index is stored in partitions for efficiency. In semantic search v3, partitions are managed automatically (one partition per 150 MB of data). No manual configuration needed.

> **If you hit a "RangeError: invalid string length" error**: This means your vault is too large for a single partition. Increase the number of partitions in QA settings. A good rule of thumb is that the first partition file (found in `.obsidian/`) should be under ~400 MB.

---

## Inline Citations (Experimental)

When enabled, AI responses in Vault QA include footnote-style citations pointing to the source notes used in the answer.

**Enable**: **Settings → Copilot → QA → Enable Inline Citations**

This is an experimental feature. Not all models handle it well.

---

## Obsidian Sync

If you use Obsidian Sync, the vector index can be synced across devices. Enable **Settings → Copilot → QA → Enable Index Sync**.

> **Note**: The index can be large (hundreds of MB for big vaults). Keep this in mind for sync limits and mobile data usage.

---

## Mobile Considerations

By default, Copilot **disables indexing on mobile** to save battery and data. The setting is in **Settings → Copilot → QA → Disable index on mobile** (on by default).

On mobile, you can still use Vault QA with lexical search, but semantic search won't update automatically.

---

## Related

- [Agent Mode and Tools](agent-mode-and-tools.md) — How @vault uses the index in Plus mode
- [Models and Parameters](models-and-parameters.md) — Choosing an embedding model
- [Copilot Plus and Self-Host](copilot-plus-and-self-host.md) — Miyo-powered local semantic search
