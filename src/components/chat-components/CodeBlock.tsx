import React, { useState } from "react";
import { Button } from "@/components/ui/button";
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

      <pre className="m-0 border-none">
        <code>{code}</code>
      </pre>
    </div>
  );
};
