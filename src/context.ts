import * as React from 'react';
import { App } from 'obsidian';
import { SharedState } from 'src/sharedState';

// App context
export const AppContext = React.createContext<App | undefined>(undefined);

// SharedState context
export const SharedStateContext = React.createContext<SharedState | undefined>(undefined);
