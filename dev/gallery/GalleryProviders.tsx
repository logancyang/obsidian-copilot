import { TooltipProvider } from "@/components/ui/tooltip";
import { AppContext, EventTargetContext, useApp } from "@/context";
import * as React from "react";

interface GalleryProvidersProps {
  children: React.ReactNode;
}

/**
 * Supplies the common runtime contexts that composite gallery stories expect.
 * Stories opt into this component explicitly so their provider needs stay visible.
 *
 * @param props - Story content that needs the gallery's Obsidian app and UI providers.
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
