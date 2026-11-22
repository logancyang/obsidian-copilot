import React, { createContext, useContext } from "react";

import type { ModelManagementApi } from "@/modelManagement/createModelManagement";

const ModelManagementContext = createContext<ModelManagementApi | undefined>(undefined);

interface ModelManagementProviderProps {
  api: ModelManagementApi;
  children: React.ReactNode;
}

export function ModelManagementProvider({
  api,
  children,
}: ModelManagementProviderProps): JSX.Element {
  return <ModelManagementContext.Provider value={api}>{children}</ModelManagementContext.Provider>;
}

export function useModelManagement(): ModelManagementApi {
  const api = useContext(ModelManagementContext);
  if (api === undefined) {
    throw new Error("useModelManagement must be used inside <ModelManagementProvider>");
  }
  return api;
}
