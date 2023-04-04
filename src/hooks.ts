import * as React from 'react';
import { App } from 'obsidian';
import { AppContext, SharedStateContext } from './context';
import { SharedState } from './sharedState';

// Custom hook to use the App context
export const useApp = (): App | undefined => {
  return React.useContext(AppContext);
};

// Custom hook to use the SharedState context
export const useSharedState = (): SharedState | undefined => {
  return React.useContext(SharedStateContext);
};

// Export both context providers
export { AppContext, SharedStateContext };
