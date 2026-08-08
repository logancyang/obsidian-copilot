/**
 * Google Generative AI adapter. Dispatch key:
 * `ProviderType === "google"`.
 *
 * Backs Gemini via `@langchain/google-genai`. No provider-level extras.
 *
 * Verification hits `GET /v1beta/models?key=…` — Google takes the API
 * key as a query parameter rather than a header.
 */

import { z } from "zod";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { VerificationResult } from "@/modelManagement/types/runtime";
import type { AdapterBuildContext, AdapterVerifyContext, ProviderAdapter } from "./ProviderAdapter";
import { verifyViaListModels } from "./verifyViaListModels";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";

const extrasSchema = z.object({}).strict();

type Extras = z.infer<typeof extrasSchema>;

export const googleAdapter: ProviderAdapter<Extras> = {
  providerType: "google",
  extrasSchema,

  buildLangChainClient(ctx: AdapterBuildContext<Extras>): BaseChatModel {
    throw new Error("[modelManagement] googleAdapter.buildLangChainClient not implemented yet");
  },

  verifyCredentials(ctx: AdapterVerifyContext<Extras>): Promise<VerificationResult> {
    if (!ctx.apiKey) {
      return Promise.resolve({
        ok: false,
        code: "missing_api_key",
        message: "An API key is required to verify this Google provider.",
        checkedAt: Date.now(),
      });
    }
    const trimmedBaseUrl = ctx.provider.baseUrl?.trim();
    const base = (trimmedBaseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    return verifyViaListModels(`${base}/v1beta/models?key=${encodeURIComponent(ctx.apiKey)}`, {});
  },
};
