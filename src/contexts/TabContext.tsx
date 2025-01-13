import React, { createContext, useContext, useEffect, useState, useRef } from "react";

interface TabContextType {
  selectedTab: string;
  setSelectedTab: (tab: string) => void;
  modalContainer: HTMLElement | null;
}

const TabContext = createContext<TabContextType | undefined>(undefined);

export const TabProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedTab, setSelectedTab] = useState("basic");
  const [modalContainer, setModalContainer] = useState<HTMLElement | null>(null);
  const hasInitialized = useRef(false);

  useEffect(() => {
    if (!hasInitialized.current) {
      const modal = document.querySelector(".modal-container") as HTMLElement;
      setModalContainer(modal);
      hasInitialized.current = true;
    }
  }, []);

  return (
    <TabContext.Provider value={{ selectedTab, setSelectedTab, modalContainer }}>
      {children}
    </TabContext.Provider>
  );
};

export const useTab = () => {
  const context = useContext(TabContext);
  if (context === undefined) {
    throw new Error("useTab must be used within a TabProvider");
  }
  return context;
};
