import { TooltipProvider } from "@/components/ui/tooltip";
import { AppContext, EventTargetContext, useApp } from "@/context";
import * as React from "react";

interface GalleryProvidersProps {
  children: React.ReactNode;
}

/**
 * Supplies the runtime contexts that composite gallery stories opt into.
 *
 * @param props - Story content that needs gallery-owned providers.
 * @returns Provider-wrapped story content.
 */
export function GalleryProviders({ children }: GalleryProvidersProps): React.ReactElement {
  const app = useApp();
  const eventTarget = React.useMemo(() => new EventTarget(), []);

  return (
    <AppContext.Provider value={app}>
      <EventTargetContext.Provider value={eventTarget}>
        <TooltipProvider delayDuration={0}>{children}</TooltipProvider>
      </EventTargetContext.Provider>
    </AppContext.Provider>
  );
}

export const galleryHostFixtures = Object.freeze({
  confirmation: Object.freeze({
    body: "The local agent configuration and its saved command history will be removed.",
    confirmLabel: "Delete configuration",
    title: "Delete local agent configuration?",
  }),
  popover: Object.freeze({
    actions: Object.freeze(["Copy response", "Insert at cursor", "Start a new chat"]),
    description: "Choose what to do with the latest assistant response.",
  }),
  settings: Object.freeze({
    description: "Use the configured fallback when the preferred model is unavailable.",
    title: "Allow model fallback",
  }),
});
