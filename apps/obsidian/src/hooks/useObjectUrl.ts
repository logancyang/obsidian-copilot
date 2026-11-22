import { useLayoutEffect, useState } from "react";

export function useObjectUrl(blob: Blob): string | undefined {
  const [url, setUrl] = useState<string>();

  useLayoutEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  return url;
}
