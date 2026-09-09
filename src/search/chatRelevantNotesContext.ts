import type { RelatedContextRequest } from "@/miyo/MiyoClient";

export interface ChatRelevantNotesContext {
  id: string;
  request: RelatedContextRequest;
  skippedAttachments: number;
  addFile: (path: string) => void;
}
