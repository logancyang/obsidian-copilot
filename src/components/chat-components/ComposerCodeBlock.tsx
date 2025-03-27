import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Check, Loader2 } from "lucide-react";
import { Component, MarkdownRenderer } from "obsidian";
import { APPLY_VIEW_TYPE } from "@/components/composer/ApplyView";
import { Composer } from "@/LLMProviders/composer";
import { logError } from "@/logger";
import { Notice } from "obsidian";

interface ComposerCodeBlockProps {
  code: string;
  path: string;
}

export const ComposerCodeBlock: React.FC<ComposerCodeBlockProps> = ({ path, code }) => {
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
    if (!path) return;

    setIsApplying(true);
    try {
      const changes = Composer.getChanges(path);

      // Open the Apply View in a new leaf with the processed content
      const leaf = app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: APPLY_VIEW_TYPE,
        active: true,
        state: {
          changes,
          path,
        },
      });
    } catch (error) {
      logError("Error calling composer apply:", error);
      new Notice(`Error processing code: ${error.message}`);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="border border-border border-solid rounded-md my-2 flex flex-col overflow-hidden">
      {path && (
        <div className="flex justify-between items-center border-[0px] border-b border-border border-solid gap-2 p-2 overflow-hidden">
          <div className="text-xs p-1 text-muted-foreground truncate flex-1">{path}</div>
          {
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
          }
        </div>
      )}

      <div ref={codeRef} className="m-0 border-none" />
    </div>
  );
};
