import SharedState from '@/sharedState';
import { App } from 'obsidian';
import * as React from 'react';

// App context
export const AppContext = React.createContext<App | undefined>(undefined);

// SharedState context
export const SharedStateContext = React.createContext<SharedState | undefined>(undefined);
