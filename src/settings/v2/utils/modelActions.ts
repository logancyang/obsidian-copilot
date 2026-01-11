import { CustomModel } from "@/aiParams";
import { ChatModelProviders, SettingKeyProviders } from "@/constants";
import { getDecryptedKey } from "@/encryptionService";
import { GitHubCopilotProvider } from "@/LLMProviders/githubCopilot/GitHubCopilotProvider";
import ProjectManager from "@/LLMProviders/projectManager";
import { logError, logWarn } from "@/logger";
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

    const tryFetch = async (useSafeFetch: boolean) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      try {
        const response = await (useSafeFetch ? safeFetch : fetch)(url, {
          headers,
          signal: controller.signal,
          method: "GET",
        });

        if (!response.ok) {
          const msg = err2String(await response.json());
          logError(msg);
          throw new Error(`Failed to fetch models: ${response.statusText} \n detail: ` + msg);
        }
        return response;
      } finally {
        clearTimeout(timeoutId);
      }
    };

    let response;
    try {
      response = await tryFetch(false);
    } catch (firstError) {
      logWarn("First fetch attempt failed, trying with safeFetch...");
      try {
        response = await tryFetch(true);
      } catch (error) {
        const msg =
          "\nwithout CORS Error: " +
          err2String(firstError) +
          "\nwith CORS Error: " +
          err2String(error);
        throw new Error(msg);
      }
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
    (m) => m.name === model.name && m.provider === model.provider
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
export function buildCustomModel(
  model: { id: string; name: string; provider: SettingKeyProviders }
): CustomModel {
  return {
    name: model.name,
    provider: model.provider,
    enabled: true,
  };
}
