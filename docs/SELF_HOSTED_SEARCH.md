# Self-Host Mode Architecture

This document describes the self-host mode integration, which allows using self-hosted services for search, LLMs, OCR, and more. Currently covers the `RetrieverFactory` and `SelfHostRetriever` abstractions for vector search.

## Summary of Changes

### New Files

| File                              | Purpose                                                                   |
| --------------------------------- | ------------------------------------------------------------------------- |
| `src/search/RetrieverFactory.ts`  | Centralized factory for creating retrievers based on settings             |
| `src/search/selfHostRetriever.ts` | Abstract retriever and backend interface for self-host mode vector search |

### Modified Files

| File                                                 | Change                                                                |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| `src/LLMProviders/chainRunner/VaultQAChainRunner.ts` | Now uses `RetrieverFactory` instead of inline if-else logic           |
| `src/tools/SearchTools.ts`                           | `lexicalSearchTool` and `localSearchTool` now use `RetrieverFactory`  |
| `src/settings/model.ts`                              | Added settings: `enableSelfHostMode`, `selfHostUrl`, `selfHostApiKey` |
| `src/constants.ts`                                   | Added default values for new settings                                 |

## Architecture

### Retriever Priority

The `RetrieverFactory` handles retriever selection with this priority:

```
1. Self-hosted (Miyo) - if enabled and backend registered
2. Semantic (MergedSemanticRetriever) - if enableSemanticSearchV3 is true
3. Lexical (TieredLexicalRetriever) - default fallback
```

### Key Interfaces

```typescript
// Backend interface - implement this for Miyo
interface VectorSearchBackend {
  search(query: string, options: {...}): Promise<VectorSearchResult[]>;
  searchByVector(embedding: number[], options: {...}): Promise<VectorSearchResult[]>;
  isAvailable(): Promise<boolean>;
  getEmbeddingDimension(): number;
}

// Factory usage
const result = await RetrieverFactory.createRetriever(app, options);
const docs = await result.retriever.getRelevantDocuments(query);
```

### Settings

| Setting              | Type    | Default | Description                       |
| -------------------- | ------- | ------- | --------------------------------- |
| `enableSelfHostMode` | boolean | false   | Enable self-host mode             |
| `selfHostUrl`        | string  | ""      | URL endpoint for the Miyo backend |
| `selfHostApiKey`     | string  | ""      | API key (if required)             |

## What To Do Next

### 1. Implement Miyo Backend

Create `src/search/backends/MiyoBackend.ts`:

```typescript
import { VectorSearchBackend, VectorSearchResult } from "../selfHostRetriever";

export class MiyoBackend implements VectorSearchBackend {
  private url: string;
  private apiKey?: string;

  constructor(config: { url: string; apiKey?: string }) {
    this.url = config.url;
    this.apiKey = config.apiKey;
  }

  async search(
    query: string,
    options: {
      limit: number;
      minScore?: number;
      filter?: Record<string, unknown>;
    }
  ): Promise<VectorSearchResult[]> {
    // TODO: Implement HTTP call to Miyo API
    // POST /search { query, limit, minScore, filter }
    throw new Error("Not implemented");
  }

  async searchByVector(
    embedding: number[],
    options: {
      limit: number;
      minScore?: number;
      filter?: Record<string, unknown>;
    }
  ): Promise<VectorSearchResult[]> {
    // TODO: Implement vector search
    // POST /search/vector { embedding, limit, minScore, filter }
    throw new Error("Not implemented");
  }

  async isAvailable(): Promise<boolean> {
    // TODO: Health check
    // GET /health
    try {
      const response = await fetch(`${this.url}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  getEmbeddingDimension(): number {
    // TODO: Return the dimension your embeddings use
    return 1536; // e.g., OpenAI ada-002
  }
}
```

### 2. Register Backend on Plugin Load

In `src/main.ts` or appropriate initialization code:

```typescript
import { RetrieverFactory } from "@/search/RetrieverFactory";
import { MiyoBackend } from "@/search/backends/MiyoBackend";

// During plugin initialization
const settings = getSettings();
if (settings.enableSelfHostMode && settings.selfHostUrl) {
  const backend = new MiyoBackend({
    url: settings.selfHostUrl,
    apiKey: settings.selfHostApiKey,
  });
  RetrieverFactory.registerSelfHostedBackend(backend);
}
```

### 3. Add Settings UI

Add toggle and input fields in `src/settings/components/QASettings.tsx`:

```tsx
// Enable toggle
<SettingItem
  name="Self-Host Mode"
  description="Use your own self-hosted services for search, LLMs, and OCR"
>
  <Toggle
    checked={settings.enableSelfHostMode}
    onChange={(value) => updateSetting("enableSelfHostMode", value)}
  />
</SettingItem>;

// URL input
{
  settings.enableSelfHostMode && (
    <>
      <SettingItem name="Miyo URL" description="URL to your Miyo instance">
        <TextInput
          value={settings.selfHostUrl}
          onChange={(value) => updateSetting("selfHostUrl", value)}
          placeholder="http://localhost:6333"
        />
      </SettingItem>
      <SettingItem name="API Key (optional)">
        <TextInput
          value={settings.selfHostApiKey}
          onChange={(value) => updateSetting("selfHostApiKey", value)}
          type="password"
        />
      </SettingItem>
    </>
  );
}
```

### 4. Handle Settings Changes

Re-register backend when settings change:

```typescript
subscribeToSettingsChange((prev, next) => {
  if (
    prev.enableSelfHostMode !== next.enableSelfHostMode ||
    prev.selfHostUrl !== next.selfHostUrl ||
    prev.selfHostApiKey !== next.selfHostApiKey
  ) {
    if (next.enableSelfHostMode && next.selfHostUrl) {
      const backend = new MiyoBackend({
        url: next.selfHostUrl,
        apiKey: next.selfHostApiKey,
      });
      RetrieverFactory.registerSelfHostedBackend(backend);
    } else {
      RetrieverFactory.clearSelfHostedBackend();
    }
  }
});
```

## Testing Checklist

- [ ] Implement `MiyoBackend` class
- [ ] Add settings UI for Miyo configuration
- [ ] Register backend on plugin load
- [ ] Handle settings changes (re-register backend)
- [ ] Test search with Miyo enabled
- [ ] Test fallback when Miyo unavailable
- [ ] Verify existing lexical/semantic search still works
