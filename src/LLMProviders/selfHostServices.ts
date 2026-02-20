import { type Youtube4llmResponse } from "@/LLMProviders/brevilabsClient";
import { getDecryptedKey } from "@/encryptionService";
import { logError, logInfo } from "@/logger";
import { getSettings } from "@/settings/model";

const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search";
const PERPLEXITY_CHAT_URL = "https://api.perplexity.ai/chat/completions";
const SUPADATA_TRANSCRIPT_URL = "https://api.supadata.ai/v1/transcript";

/** Poll interval for Supadata async jobs (ms) */
const SUPADATA_POLL_INTERVAL = 2000;
/** Maximum time to wait for a Supadata async job (ms) */
const SUPADATA_POLL_TIMEOUT = 60000;

/** Clean web search result — no legacy Perplexity wrapper */
export interface SelfHostWebSearchResult {
  content: string;
  citations: string[];
}

interface FirecrawlSearchResult {
  title?: string;
  description?: string;
  url?: string;
}

/**
 * Check whether the currently selected self-host search provider has an API key configured.
 */
export function hasSelfHostSearchKey(): boolean {
  const settings = getSettings();
  switch (settings.selfHostSearchProvider) {
    case "perplexity":
      return !!settings.perplexityApiKey;
    case "firecrawl":
    default:
      return !!settings.firecrawlApiKey;
  }
}

/**
 * Web search via Firecrawl direct API (self-host mode).
 * Handles both v2 `data.web` format and older flat `data` array.
 */
async function firecrawlSearch(query: string, apiKey: string): Promise<SelfHostWebSearchResult> {
  const startTime = Date.now();

  const response = await fetch(FIRECRAWL_SEARCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, limit: 5 }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firecrawl search failed (${response.status}): ${text}`);
  }

  const json = await response.json();

  // v2 returns { data: { web: [...] } }, older responses return { data: [...] }
  const rawData = json?.data;
  const results: FirecrawlSearchResult[] = Array.isArray(rawData)
    ? rawData
    : Array.isArray(rawData?.web)
      ? rawData.web
      : [];

  const contentParts: string[] = [];
  const citations: string[] = [];

  for (const item of results) {
    const title = item.title || "Untitled";
    const description = item.description || "";
    const url = item.url || "";
    contentParts.push(`### ${title}\n${description}\nSource: ${url}`);
    if (url) {
      citations.push(url);
    }
  }

  const elapsed = Date.now() - startTime;
  logInfo(`[selfHostWebSearch] Firecrawl: ${results.length} results in ${elapsed}ms`);

  return { content: contentParts.join("\n\n"), citations };
}

/**
 * Web search via Perplexity Sonar API (self-host mode).
 */
async function perplexitySonarSearch(
  query: string,
  apiKey: string
): Promise<SelfHostWebSearchResult> {
  const response = await fetch(PERPLEXITY_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [{ role: "user", content: query }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Perplexity Sonar search failed (${response.status}): ${text}`);
  }

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content ?? "";
  const citations: string[] = Array.isArray(json?.citations) ? json.citations : [];

  return { content, citations };
}

/**
 * Dispatch self-host web search to the provider selected in settings.
 * Returns content + citations directly without the legacy Perplexity wrapper.
 */
export async function selfHostWebSearch(query: string): Promise<SelfHostWebSearchResult> {
  const settings = getSettings();
  switch (settings.selfHostSearchProvider) {
    case "perplexity":
      return perplexitySonarSearch(query, await getDecryptedKey(settings.perplexityApiKey));
    case "firecrawl":
    default:
      return firecrawlSearch(query, await getDecryptedKey(settings.firecrawlApiKey));
  }
}

/**
 * YouTube transcript via Supadata direct API (self-host mode).
 * Returns the same Youtube4llmResponse shape as BrevilabsClient.youtube4llm().
 */
export async function selfHostYoutube4llm(url: string): Promise<Youtube4llmResponse> {
  const startTime = Date.now();
  const apiKey = await getDecryptedKey(getSettings().supadataApiKey);

  const transcriptUrl = `${SUPADATA_TRANSCRIPT_URL}?url=${encodeURIComponent(url)}&mode=auto&text=true`;

  const response = await fetch(transcriptUrl, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      Accept: "application/json",
    },
  });

  if (response.status === 200) {
    const json = await response.json();
    const elapsed = Date.now() - startTime;
    logInfo(`[selfHostYoutube4llm] transcript received in ${elapsed}ms`);
    return {
      response: { transcript: json.content || "" },
      elapsed_time_ms: elapsed,
    };
  }

  if (response.status === 201 || response.status === 202) {
    const json = await response.json();
    const jobId = json.job_id;
    if (!jobId) {
      throw new Error("Supadata returned async status but no job_id");
    }
    return await pollSupadataJob(jobId, apiKey, startTime);
  }

  const text = await response.text();
  throw new Error(`Supadata transcript request failed (${response.status}): ${text}`);
}

/**
 * Poll a Supadata async transcript job until it completes or times out.
 */
async function pollSupadataJob(
  jobId: string,
  apiKey: string,
  startTime: number
): Promise<Youtube4llmResponse> {
  const deadline = Date.now() + SUPADATA_POLL_TIMEOUT;
  const pollUrl = `${SUPADATA_TRANSCRIPT_URL}/${jobId}`;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SUPADATA_POLL_INTERVAL));

    const pollResponse = await fetch(pollUrl, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        Accept: "application/json",
      },
    });

    if (pollResponse.status === 200) {
      const json = await pollResponse.json();
      const elapsed = Date.now() - startTime;
      logInfo(`[selfHostYoutube4llm] async transcript completed in ${elapsed}ms`);
      return {
        response: { transcript: json.content || "" },
        elapsed_time_ms: elapsed,
      };
    }

    if (pollResponse.status === 202) {
      continue;
    }

    const text = await pollResponse.text();
    logError(`[selfHostYoutube4llm] poll failed (${pollResponse.status}): ${text}`);
    throw new Error(`Supadata poll failed (${pollResponse.status}): ${text}`);
  }

  throw new Error(`Supadata transcript timed out after ${SUPADATA_POLL_TIMEOUT}ms`);
}
