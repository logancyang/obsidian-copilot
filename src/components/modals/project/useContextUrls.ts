import type { ProjectConfig } from "@/aiParams";
import {
  parseProjectUrls,
  parseUrlsFromText,
  serializeProjectUrls,
  type UrlItem,
} from "@/utils/urlTagUtils";
import { useCallback, useMemo, useState } from "react";

export interface ContextUrlsState {
  webUrls: string;
  youtubeUrls: string;
  urlItems: UrlItem[];
  addFromText: (text: string) => void;
  removeUrl: (id: string) => void;
}

export function useContextUrls(initial: ProjectConfig): ContextUrlsState {
  const [webUrls, setWebUrls] = useState(initial.contextSource?.webUrls ?? "");
  const [youtubeUrls, setYoutubeUrls] = useState(initial.contextSource?.youtubeUrls ?? "");

  const urlItems = useMemo(() => parseProjectUrls(webUrls, youtubeUrls), [webUrls, youtubeUrls]);

  const commit = useCallback((items: UrlItem[]) => {
    const serialized = serializeProjectUrls(items);
    setWebUrls(serialized.webUrls);
    setYoutubeUrls(serialized.youtubeUrls);
  }, []);

  const addFromText = useCallback(
    (text: string) => {
      const added = parseUrlsFromText(
        text,
        urlItems.map((u) => u.url)
      );
      if (added.length > 0) commit([...urlItems, ...added]);
    },
    [urlItems, commit]
  );

  const removeUrl = useCallback(
    (id: string) => {
      commit(urlItems.filter((u) => u.id !== id));
    },
    [urlItems, commit]
  );

  return { webUrls, youtubeUrls, urlItems, addFromText, removeUrl };
}
