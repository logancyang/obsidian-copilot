import type { CustomModel } from "@/aiParams";

export function getModelKeyFromModel(model: CustomModel & { _backendId?: string }): string {
  const base = `${model.name}|${model.provider}`;
  return model._backendId ? `${model._backendId}:${base}` : base;
}
