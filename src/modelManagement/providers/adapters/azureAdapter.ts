/**
 * Azure OpenAI adapter. Dispatch key: `ProviderType === "azure"`.
 *
 * Azure OpenAI requires three pieces of routing information beyond
 * the API key:
 *   - `azureInstanceName`   — the resource name in your Azure
 *                              subscription (e.g. `my-org-eastus`).
 *   - `azureDeploymentName` — the deployment id created in the Azure
 *                              portal. Wire model id flows through
 *                              the deployment, not directly to the
 *                              SDK.
 *   - `azureApiVersion`     — Azure pins clients to a dated API
 *                              version (e.g. `2024-08-01-preview`).
 *
 * All three are required; the schema rejects missing or empty values.
 *
 * Verification hits the data-plane `/openai/deployments` endpoint with
 * the resource's `api-key` header — returns the deployment list using
 * the same key the chat completions endpoint takes, so no separate
 * Management plane permissions are needed.
 */

import { z } from "zod";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { VerificationResult } from "@/modelManagement/types/runtime";
import type { AdapterBuildContext, AdapterVerifyContext, ProviderAdapter } from "./ProviderAdapter";
import { verifyViaListModels } from "./verifyViaListModels";

// Azure Cognitive Services resource names are alphanumeric + hyphens.
// Enforce here so a stray `/`, `.`, or `:` can't redirect the
// api-key-bearing verification request to an arbitrary host via the
// `https://<instance>.openai.azure.com` interpolation below.
const AZURE_INSTANCE_NAME_RE = /^[a-zA-Z0-9-]+$/;

const extrasSchema = z
  .object({
    azureInstanceName: z
      .string()
      .min(1)
      .regex(AZURE_INSTANCE_NAME_RE, "must contain only letters, digits, and hyphens"),
    azureDeploymentName: z.string().min(1),
    azureApiVersion: z.string().min(1),
  })
  .strict();

type Extras = z.infer<typeof extrasSchema>;

export const azureAdapter: ProviderAdapter<Extras> = {
  providerType: "azure",
  extrasSchema,

  buildLangChainClient(ctx: AdapterBuildContext<Extras>): BaseChatModel {
    throw new Error("[modelManagement] azureAdapter.buildLangChainClient not implemented yet");
  },

  verifyCredentials(ctx: AdapterVerifyContext<Extras>): Promise<VerificationResult> {
    if (!ctx.apiKey) {
      return Promise.resolve({
        ok: false,
        code: "missing_api_key",
        message: "An API key is required to verify this Azure provider.",
        checkedAt: Date.now(),
      });
    }
    const { azureInstanceName, azureApiVersion } = ctx.extras;
    const url =
      `https://${azureInstanceName}.openai.azure.com/openai/deployments` +
      `?api-version=${encodeURIComponent(azureApiVersion)}`;
    return verifyViaListModels(url, { "api-key": ctx.apiKey });
  },
};
