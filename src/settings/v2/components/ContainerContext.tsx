import { createContext, useContext } from "react";

export const ContainerContext = createContext<HTMLElement | null>(null);

export const useContainerContext = () => {
  return useContext(ContainerContext);
};
