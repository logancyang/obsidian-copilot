import { App } from "obsidian";
import * as React from "react";

// App context
export const AppContext = React.createContext<App | undefined>(undefined);

// Event target context
export const EventTargetContext = React.createContext<EventTarget | undefined>(undefined);
