/**
 * React context for the model-management API.
 *
 * Reactive READS go through Jotai atoms in `state/atoms.ts` — those
 * don't need a context provider. This context is for MUTATIONS:
 * setup APIs, the coordinator, registry write methods, the catalog
 * service's `refresh()`. UI components that mutate state pull the
 * `ModelManagementApi` through `useModelManagement()`.
 *
 * The host (`main.ts`) wraps its React tree in
 * `<ModelManagementProvider api={...}>` once. Throwing on missing
 * context surfaces wiring bugs immediately rather than handing back
 * an undefined api.
 */

import React, { createContext, useContext } from "react";

import type { ModelManagementApi } from "@/modelManagement/createModelManagement";

const ModelManagementContext = createContext<ModelManagementApi | undefined>(undefined);

interface ModelManagementProviderProps {
  api: ModelManagementApi;
  children: React.ReactNode;
}

/**
 * Wraps a React subtree with the model-management api. The host
 * provides the api once near the root; descendants pull it through
 * `useModelManagement()`.
 */
export function ModelManagementProvider({
  api,
  children,
}: ModelManagementProviderProps): JSX.Element {
  return <ModelManagementContext.Provider value={api}>{children}</ModelManagementContext.Provider>;
}

/**
 * Hook for components that need to MUTATE model-management state.
 * Throws if no `<ModelManagementProvider>` ancestor is mounted —
 * always wrap the relevant subtree at plugin init.
 *
 * For reactive reads, prefer the atoms exported from
 * `@/modelManagement` (e.g. `byokProvidersAtom`,
 * `backendPickerAtomFamily`) over a registry method on the api.
 */
export function useModelManagement(): ModelManagementApi {
  const api = useContext(ModelManagementContext);
  if (api === undefined) {
    throw new Error("useModelManagement must be used inside <ModelManagementProvider>");
  }
  return api;
}
