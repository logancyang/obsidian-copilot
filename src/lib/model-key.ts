import type { CustomModel } from "@/aiParams";

/**
 * Return the stable model identity shared by selectors, persisted settings, and agent backends.
 *
 * @param model - Model descriptor whose optional backend id disambiguates agent-native aliases.
 */
export function getModelKeyFromModel(model: CustomModel & { _backendId?: string }): string {
  const base = `${model.name}|${model.provider}`;
  return model._backendId ? `${model._backendId}:${base}` : base;
}
