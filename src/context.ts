import { App } from "obsidian";
import * as React from "react";

// App context
export const AppContext = React.createContext<App | undefined>(undefined);
