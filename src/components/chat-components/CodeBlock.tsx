import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Check, Loader2 } from "lucide-react";
import { Component, MarkdownRenderer } from "obsidian";

interface CodeBlockProps {
  code: string;
  path?: string;
  onApply?: (path: string, code: string) => Promise<void>;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ code, path, onApply }) => {
  const [isApplying, setIsApplying] = useState(false);
  const codeRef = useRef<HTMLDivElement>(null);
  const componentRef = useRef<Component | null>(null);

  useEffect(() => {
    if (codeRef.current && path) {
      // Create a new Component instance if it doesn't exist
      if (!componentRef.current) {
        componentRef.current = new Component();
      }

      // Clear previous content
      codeRef.current.innerHTML = "";

      // Render markdown content
      MarkdownRenderer.renderMarkdown(code, codeRef.current, path, componentRef.current);

      // Cleanup function
      return () => {
        if (componentRef.current) {
          componentRef.current.unload();
          componentRef.current = null;
        }
      };
    }
  }, [code, path]);

  const handleApply = async () => {
    if (!path || !onApply) return;

    setIsApplying(true);
    try {
      await onApply(path, code);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="border border-border border-solid rounded-md my-2 flex flex-col overflow-hidden">
      {path && (
        <div className="flex justify-between items-center border-[0px] border-b border-border border-solid gap-2 p-2 overflow-hidden">
          <div className="text-xs p-1 text-muted-foreground truncate flex-1">{path}</div>
          {onApply && (
            <Button
              className="text-muted"
              variant="ghost2"
              size="fit"
              onClick={handleApply}
              disabled={isApplying}
            >
              {isApplying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Apply
            </Button>
          )}
        </div>
      )}

      <div ref={codeRef} className="m-0 border-none" />
    </div>
  );
};
