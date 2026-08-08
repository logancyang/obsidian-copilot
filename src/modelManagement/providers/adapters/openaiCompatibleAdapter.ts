/**
 * OpenAI-compatible adapter. Dispatch key:
 * `ProviderType === "openai-compatible"`.
 *
 * Covers the OpenAI SDK family — OpenAI proper, plus everything that
 * speaks the OpenAI Chat Completions wire format with a custom
 * `baseUrl`: Mistral, Groq, OpenRouter, Together, DeepSeek, xAI,
 * SiliconFlow, Ollama, LMStudio, and arbitrary custom proxies.
 *
 * The only optional extra is the OpenAI organization id, which a
 * subset of OpenAI accounts require. Everything else (base URL, API
 * key) lives on `Provider` directly.
 *
 * Verification hits the standard `GET /models` endpoint — implemented
 * by every public OpenAI-compatible provider and by both local
 * runners (Ollama / LMStudio) — except for providers whose `/models`
 * is public (OpenRouter), which verify against an auth-gated path via
 * `openaiCompatibleVerifyPath`.
 */

import { z } from "zod";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { VerificationResult } from "@/modelManagement/types/runtime";
import type { AdapterBuildContext, AdapterVerifyContext, ProviderAdapter } from "./ProviderAdapter";
import { verifyPathForCatalogProviderId } from "./openaiCompatibleVerifyPath";
import { verifyViaListModels } from "./verifyViaListModels";

const extrasSchema = z
  .object({
    /** OpenAI organization id (e.g. `org-…`). Only meaningful for
     *  OpenAI proper; ignored by other OpenAI-compatible endpoints. */
    openAIOrgId: z.string().optional(),
  })
  .strict();

type Extras = z.infer<typeof extrasSchema>;

export const openaiCompatibleAdapter: ProviderAdapter<Extras> = {
  providerType: "openai-compatible",
  extrasSchema,

  buildLangChainClient(ctx: AdapterBuildContext<Extras>): BaseChatModel {
    throw new Error(
      "[modelManagement] openaiCompatibleAdapter.buildLangChainClient not implemented yet"
    );
  },

  verifyCredentials(ctx: AdapterVerifyContext<Extras>): Promise<VerificationResult> {
    const baseUrl = ctx.provider.baseUrl?.trim();
    if (!baseUrl) {
      return Promise.resolve({
        ok: false,
        code: "missing_base_url",
        message: "A base URL is required to verify this OpenAI-compatible provider.",
        checkedAt: Date.now(),
      });
    }
    const base = baseUrl.replace(/\/$/, "");

    // No `missing_api_key` guard here — the adapter cannot tell whether
    // an absent key is legitimate (Ollama / LMStudio, which set
    // `requiresApiKey: false` at the template layer) or a mistake on
    // OpenAI proper. Let the server's 401 surface as `invalid_api_key`
    // in the cases that matter.
    const headers: Record<string, string> = {};
    if (ctx.apiKey) {
      headers["Authorization"] = `Bearer ${ctx.apiKey}`;
    }
    if (ctx.extras.openAIOrgId) {
      headers["OpenAI-Organization"] = ctx.extras.openAIOrgId;
    }

    // Most providers gate `/models` behind the key; the few whose `/models`
    // is public (OpenRouter) verify against an auth-gated path instead, keyed
    // by catalog id. `verifyViaListModels` already maps 401/403 →
    // `invalid_api_key`, so the `/key` probe needs no special handling.
    const catalogProviderId =
      ctx.provider.origin.kind === "byok" ? ctx.provider.origin.catalogProviderId : undefined;
    const verifyPath = verifyPathForCatalogProviderId(catalogProviderId);

    return verifyViaListModels(`${base}/${verifyPath}`, headers);
  },
};
