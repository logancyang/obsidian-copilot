import * as React from "react";
import { useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle, Database, Loader2, Pause, Play, Square, X } from "lucide-react";
import { useIndexingProgress } from "@/aiParams";

interface IndexingProgressCardProps {
  onClose: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

/**
 * In-chat progress card for vault indexing operations.
 * Replaces the old Obsidian Notice-based progress display.
 */
export default function IndexingProgressCard({
  onClose,
  onPause,
  onResume,
  onStop,
}: IndexingProgressCardProps) {
  const [indexingState] = useIndexingProgress();
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { isActive, isPaused, indexedCount, totalFiles, errors, completionStatus } = indexingState;

  const progressPercentage = totalFiles > 0 ? Math.round((indexedCount / totalFiles) * 100) : 0;

  // Auto-close 3s after completion
  useEffect(() => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }

    // Auto-close on success/cancel but not on pre-indexing errors (user needs to read the message)
    const shouldAutoClose =
      !isActive &&
      completionStatus !== "none" &&
      !(completionStatus === "error" && totalFiles === 0);
    if (shouldAutoClose) {
      autoCloseTimerRef.current = setTimeout(() => {
        onClose();
      }, 3000);
    }

    return () => {
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current);
        autoCloseTimerRef.current = null;
      }
    };
  }, [isActive, completionStatus, totalFiles, onClose]);

  /** Title text based on current state */
  const getTitle = () => {
    if (completionStatus === "success")
      return totalFiles === 0 ? "Index Up to Date" : "Indexing Complete";
    if (completionStatus === "cancelled") return "Indexing Cancelled";
    if (completionStatus === "error") {
      // If totalFiles is 0, indexing never started (e.g. embedding model unavailable)
      return totalFiles === 0 ? "Indexing Failed" : "Indexing Complete (with errors)";
    }
    if (isPaused) return "Indexing Paused";
    return "Indexing Vault";
  };

  /** Status icon */
  const getStatusIcon = () => {
    if (!isActive && completionStatus !== "none") {
      if (completionStatus === "error") return <AlertCircle className="tw-size-4 tw-text-error" />;
      if (completionStatus === "success")
        return <CheckCircle className="tw-size-4 tw-text-success" />;
      return <Database className="tw-size-4" />;
    }
    if (isPaused) return <Pause className="tw-size-4 tw-text-warning" />;
    return <Loader2 className="tw-size-4 tw-animate-spin tw-text-accent" />;
  };

  return (
    <Card className="tw-w-full tw-border tw-border-solid tw-border-border tw-bg-transparent tw-shadow-none">
      <CardHeader>
        <CardTitle className="tw-flex tw-items-center tw-justify-between tw-gap-2">
          <div className="tw-flex tw-items-center tw-gap-2">
            {getStatusIcon()}
            <span className="tw-text-sm">{getTitle()}</span>
          </div>
          <Button
            size="sm"
            variant="ghost2"
            className="tw-size-6 tw-p-0 tw-text-muted"
            title="Close"
            onClick={onClose}
          >
            <X className="tw-size-4" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="tw-space-y-3">
        {totalFiles > 0 && (
          <div className="tw-space-y-2">
            <div className="tw-flex tw-items-center tw-justify-between tw-text-sm">
              <span className="tw-text-muted">
                {indexedCount}/{totalFiles} files
              </span>
              <span className="tw-font-medium">{progressPercentage}%</span>
            </div>
            <Progress value={progressPercentage} className="tw-h-2" />
          </div>
        )}

        {errors.length > 0 && (
          <div className="tw-flex tw-flex-col tw-gap-1">
            <div className="tw-flex tw-items-center tw-gap-2">
              <AlertCircle className="tw-size-3 tw-text-error" />
              <Badge variant="destructive" className="tw-text-xs">
                {errors.length} {errors.length === 1 ? "error" : "errors"}
              </Badge>
            </div>
            {totalFiles === 0 && errors[0] && (
              <span className="tw-text-xs tw-text-error">{errors[0]}</span>
            )}
          </div>
        )}

        {isActive && (
          <div className="tw-flex tw-items-center tw-gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="tw-h-6 tw-px-2 tw-text-xs"
              onClick={isPaused ? onResume : onPause}
            >
              {isPaused ? (
                <>
                  <Play className="tw-mr-1 tw-size-3" />
                  Resume
                </>
              ) : (
                <>
                  <Pause className="tw-mr-1 tw-size-3" />
                  Pause
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="tw-h-6 tw-px-2 tw-text-xs"
              onClick={onStop}
            >
              <Square className="tw-mr-1 tw-size-3" />
              Stop
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
