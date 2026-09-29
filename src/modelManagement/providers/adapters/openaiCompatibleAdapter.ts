import * as z from "zod";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { VerificationResult } from "@/modelManagement/types/runtime";
import type { AdapterBuildContext, AdapterVerifyContext, ProviderAdapter } from "./ProviderAdapter";
import { verifyPathForCatalogProviderId } from "./openaiCompatibleVerifyPath";
import { verifyViaListModels } from "./verifyViaListModels";

const extrasSchema = z
  .object({
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

    const headers: Record<string, string> = {};
    if (ctx.apiKey) {
      headers["Authorization"] = `Bearer ${ctx.apiKey}`;
    }
    if (ctx.extras.openAIOrgId) {
      headers["OpenAI-Organization"] = ctx.extras.openAIOrgId;
    }

    const catalogProviderId =
      ctx.provider.origin.kind === "byok" ? ctx.provider.origin.catalogProviderId : undefined;
    const verifyPath = verifyPathForCatalogProviderId(catalogProviderId);

    return verifyViaListModels(`${base}/${verifyPath}`, headers);
  },
};
