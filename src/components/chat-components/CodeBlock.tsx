import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check, Loader2 } from "lucide-react";

interface CodeBlockProps {
  code: string;
  path?: string;
  onApply?: (path: string, code: string) => Promise<void>;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ code, path, onApply }) => {
  const [isApplying, setIsApplying] = useState(false);

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
    <div className="relative">
      {path && (
        <div className="code-path-indicator text-xs p-1 border-b border-border text-muted-foreground">
          {path}
        </div>
      )}
      <pre className="relative">
        <code>{code}</code>
        {path && onApply && (
          <Button
            variant="default"
            size="sm"
            className={cn(
              "absolute top-2 right-2 bg-primary hover:bg-primary/90 text-primary-foreground",
              "shadow-sm border border-border",
              isApplying && "opacity-70 cursor-not-allowed"
            )}
            onClick={handleApply}
            disabled={isApplying}
          >
            {isApplying ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-1 h-4 w-4" />
            )}
            Apply
          </Button>
        )}
      </pre>
    </div>
  );
};
