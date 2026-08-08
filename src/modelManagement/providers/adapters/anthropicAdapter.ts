/**
 * Anthropic adapter. Dispatch key: `ProviderType === "anthropic"`.
 *
 * Anthropic has no provider-level extras. `baseUrl` and `apiKey`
 * cover everything the SDK needs.
 *
 * `buildLangChainClient` is still a placeholder; `verifyCredentials`
 * is implemented via Anthropic's `/v1/models` endpoint.
 */

import { z } from "zod";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { VerificationResult } from "@/modelManagement/types/runtime";
import type { AdapterBuildContext, AdapterVerifyContext, ProviderAdapter } from "./ProviderAdapter";
import { verifyViaListModels } from "./verifyViaListModels";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

const extrasSchema = z.object({}).strict();

type Extras = z.infer<typeof extrasSchema>;

export const anthropicAdapter: ProviderAdapter<Extras> = {
  providerType: "anthropic",
  extrasSchema,

  buildLangChainClient(ctx: AdapterBuildContext<Extras>): BaseChatModel {
    throw new Error("[modelManagement] anthropicAdapter.buildLangChainClient not implemented yet");
  },

  verifyCredentials(ctx: AdapterVerifyContext<Extras>): Promise<VerificationResult> {
    if (!ctx.apiKey) {
      return Promise.resolve({
        ok: false,
        code: "missing_api_key",
        message: "An API key is required to verify this Anthropic provider.",
        checkedAt: Date.now(),
      });
    }
    const trimmedBaseUrl = ctx.provider.baseUrl?.trim();
    const base = (trimmedBaseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    return verifyViaListModels(`${base}/v1/models`, {
      "x-api-key": ctx.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      // Required when calling Anthropic from a browser-like runtime
      // (Obsidian's Electron renderer / mobile WebView). `requestUrl`
      // is not subject to CORS itself, but Anthropic still gates the
      // request server-side without this header.
      "anthropic-dangerous-direct-browser-access": "true",
    });
  },
};
