/**
 * AWS Bedrock adapter. Dispatch key: `ProviderType === "bedrock"`.
 *
 * Bedrock routes by region instead of base URL — the region is part
 * of the SDK construction, not a URL the user types. Always prefer a
 * cross-region inference profile id at the wire layer (e.g.
 * `global.anthropic.claude-sonnet-4-5-20250929-v1:0`, see
 * AGENTS.md → "AWS Bedrock Usage"). That belongs in
 * `ConfiguredModel.info.id`, not here.
 */

import { z } from "zod";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { VerificationResult } from "@/modelManagement/types/runtime";
import type { AdapterBuildContext, AdapterVerifyContext, ProviderAdapter } from "./ProviderAdapter";

const extrasSchema = z
  .object({
    /** AWS region (e.g. `us-east-1`). Required — Bedrock's SDK
     *  rejects calls without a region. */
    bedrockRegion: z.string().min(1),
  })
  .strict();

type Extras = z.infer<typeof extrasSchema>;

export const bedrockAdapter: ProviderAdapter<Extras> = {
  providerType: "bedrock",
  extrasSchema,

  buildLangChainClient(ctx: AdapterBuildContext<Extras>): BaseChatModel {
    throw new Error("[modelManagement] bedrockAdapter.buildLangChainClient not implemented yet");
  },

  verifyCredentials(ctx: AdapterVerifyContext<Extras>): Promise<VerificationResult> {
    // AWS Bedrock requires SigV4-signed requests; there's no flat
    // HTTP `GET /models` endpoint. Real verification (signed
    // ListFoundationModels or STS GetCallerIdentity) lands together
    // with `buildLangChainClient` in a follow-up.
    return Promise.resolve({
      ok: false,
      code: "not_implemented",
      message:
        "AWS Bedrock verification is not yet supported. Save the provider, then test it from the chat picker.",
      checkedAt: Date.now(),
    });
  },
};
