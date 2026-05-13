import { CustomModel } from "@/aiParams";
import { ChatModelProviders, SettingKeyProviders } from "@/constants";
import { getDecryptedKey } from "@/encryptionService";
import { GitHubCopilotProvider } from "@/LLMProviders/githubCopilot/GitHubCopilotProvider";
import ProjectManager from "@/LLMProviders/projectManager";
import { logError } from "@/logger";
import { parseModelsResponse, StandardModel } from "@/settings/providerModels";
import { err2String, getProviderInfo, safeFetch } from "@/utils";
import { getApiKeyForProvider } from "@/utils/modelUtils";

export interface FetchModelsResult {
  success: boolean;
  models: StandardModel[];
  error?: string;
}

export interface AddModelResult {
  success: boolean;
  alreadyExists: boolean;
  verificationFailed: boolean;
  verificationError?: string;
}

/**
 * Fetch models for a provider
 */
export async function fetchModelsForProvider(
  provider: SettingKeyProviders
): Promise<FetchModelsResult> {
  try {
    // Special handling for GitHub Copilot
    if (provider === ChatModelProviders.GITHUB_COPILOT) {
      const copilotProvider = GitHubCopilotProvider.getInstance();
      const response = await copilotProvider.listModels();
      const models = parseModelsResponse(provider, response);
      return { success: true, models };
    }

    // Standard API key based providers
    let apiKey = getApiKeyForProvider(provider);
    if (!apiKey) {
      return { success: false, models: [], error: "API key not configured" };
    }

    apiKey = await getDecryptedKey(apiKey);
    if (!apiKey) {
      return { success: false, models: [], error: "Failed to decrypt API key" };
    }

    let url = getProviderInfo(provider).listModelURL;
    if (!url) {
      return { success: false, models: [], error: "Provider does not support model listing" };
    }

    let headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
    };

    if (provider === ChatModelProviders.GOOGLE) {
      url += `?key=${apiKey}`;
      headers = {};
    } else if (provider === ChatModelProviders.ANTHROPIC) {
      headers = {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      };
    }

    // Use safeFetch (requestUrl) to bypass CORS on desktop and mobile. safeFetch
    // does not honor AbortSignal, so bound the call manually via Promise.race.
    const response = await Promise.race([
      safeFetch(url, { headers, method: "GET" }),
      new Promise<never>((_, reject) =>
        window.setTimeout(() => reject(new Error("Request timed out after 10s")), 10000)
      ),
    ]);
    if (!response.ok) {
      const msg = err2String(await response.json());
      logError(msg);
      throw new Error(`Failed to fetch models: ${response.statusText} \n detail: ` + msg);
    }

    const rawData = await response.json();
    const models = parseModelsResponse(provider, rawData);
    return { success: true, models };
  } catch (error) {
    logError(`Error fetching models for ${provider}:`, error);
    return { success: false, models: [], error: err2String(error) };
  }
}

/**
 * Verify and add a model to activeModels
 */
export async function verifyAndAddModel(
  model: { id: string; name: string; provider: SettingKeyProviders },
  activeModels: CustomModel[],
  options?: { skipVerification?: boolean }
): Promise<AddModelResult> {
  const skipVerification = options?.skipVerification ?? false;

  // Check if model already exists
  const existingModel = activeModels.find(
    (m) => m.name === model.name && (m.provider as SettingKeyProviders) === model.provider
  );

  const alreadyExists = Boolean(existingModel);

  // Build CustomModel
  const apiKey =
    model.provider === ChatModelProviders.GITHUB_COPILOT
      ? undefined
      : getApiKeyForProvider(model.provider);

  const customModel: CustomModel = {
    name: model.name,
    provider: model.provider,
    apiKey,
    enabled: true,
  };

  // Verify model if not skipped
  let verificationFailed = false;
  let verificationError: string | undefined;

  if (!skipVerification) {
    try {
      await ProjectManager.instance.getCurrentChainManager().chatModelManager.ping(customModel);
    } catch (error) {
      verificationFailed = true;
      verificationError = err2String(error);

      // For GitHub Copilot models, a "not supported" 400 typically means the user
      // hasn't enabled this model on their GitHub settings page. Append the policy
      // terms (which include an activation link) to guide the user.
      if (
        (customModel.provider as ChatModelProviders) === ChatModelProviders.GITHUB_COPILOT &&
        verificationError.toLowerCase().includes("not supported")
      ) {
        // Reason: policy cache is keyed by model.id, not customModel.name (display name)
        const terms = GitHubCopilotProvider.getInstance().getPolicyTerms(model.id);
        if (terms) {
          verificationError += `\n\n${terms}`;
        }
      }

      logError("Model verification failed:", error);
    }
  }

  return {
    success: true,
    alreadyExists,
    verificationFailed,
    verificationError,
  };
}

/**
 * Build CustomModel object for adding to activeModels
 */
export function buildCustomModel(model: {
  id: string;
  name: string;
  provider: SettingKeyProviders;
}): CustomModel {
  return {
    name: model.name,
    provider: model.provider,
    enabled: true,
  };
}
