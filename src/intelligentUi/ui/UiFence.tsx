import { parseIntelligentUi } from "@/intelligentUi/parser";
import { IntelligentUi } from "@/intelligentUi/ui/IntelligentUi";
import React from "react";

export interface UiFenceProps {
  source: string;
  sourcePath: string;
  streaming: boolean;
  closed: boolean;
}

export function UiFence({ source, sourcePath, streaming, closed }: UiFenceProps) {
  const result = parseIntelligentUi(source);
  // Stopped incomplete replies retain every token just like saved note blocks. https://github.com/Brevilabs/obsidian-copilot-private/issues/883
  if (result.status === "pending" && !(streaming && !closed)) {
    return (
      <pre>
        <code>{source}</code>
      </pre>
    );
  }
  return (
    <IntelligentUi
      result={result}
      source={source}
      sourcePath={sourcePath}
      pending={streaming && !closed}
    />
  );
}
