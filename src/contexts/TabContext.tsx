import React, { createContext, useContext, useMemo, useState } from "react";

interface TabContextType {
  selectedTab: string;
  setSelectedTab: (tab: string) => void;
  modalContainer: HTMLElement | null;
}

const TabContext = createContext<TabContextType | undefined>(undefined);

export const TabProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedTab, setSelectedTab] = useState("basic");
  // Compute the modal container lazily once; activeDocument is stable at provider
  // mount inside an Obsidian modal, so avoid an effect that would re-render.
  const [modalContainer] = useState<HTMLElement | null>(() =>
    activeDocument.querySelector(".modal-container")
  );

  const value = useMemo(
    () => ({ selectedTab, setSelectedTab, modalContainer }),
    [selectedTab, modalContainer]
  );

  return <TabContext.Provider value={value}>{children}</TabContext.Provider>;
};

export const useTab = () => {
  const context = useContext(TabContext);
  if (context === undefined) {
    throw new Error("useTab must be used within a TabProvider");
  }
  return context;
};
