import * as React from "react";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import { FailedItem, useProjectContextLoad } from "@/aiParams";
import { Button } from "@/components/ui/button";
import { TruncatedText } from "@/components/TruncatedText";
import CopilotPlugin from "@/main";
import { logError } from "@/logger";

interface ProgressCardProps {
  plugin?: CopilotPlugin;
  setHiddenCard: (hidden: boolean) => void;
  onEditContext?: () => void;
}

export default function ProgressCard({ plugin, setHiddenCard, onEditContext }: ProgressCardProps) {
  const [contextLoadState] = useProjectContextLoad();
  const totalFiles = contextLoadState.total;
  const successFiles = contextLoadState.success;
  const failedFiles = contextLoadState.failed;
  const processingFiles = contextLoadState.processingFiles;

  // Control file list expand/collapse state
  const [isProcessingExpanded, setIsProcessingExpanded] = useState(false);
  const [isFailedExpanded, setIsFailedExpanded] = useState(false);

  const processedFilesLen = successFiles.length + failedFiles.length;
  const progressPercentage =
    totalFiles.length > 0 ? Math.round((processedFilesLen / totalFiles.length) * 100) : 0;

  const getFailedItemDisplayName = (item: FailedItem): string => {
    return item.path;
  };

  // TODO(emt-lin): maybe use it in the future
  /*const handleRetryAllFailed = () => {
    console.log("Retrying all failed items");
  };*/

  const handleRetryFailedItem = async (item: FailedItem) => {
    if (!plugin?.projectManager) {
      logError("ProjectManager not available");
      return;
    }

    try {
      await plugin.projectManager.retryFailedItem(item);
    } catch (error) {
      logError(`Error retrying failed item: ${error}`);
    }
  };

  return (
    <Card className="tw-w-full tw-border tw-border-solid tw-border-border tw-bg-transparent tw-shadow-none">
      <CardHeader>
        <CardTitle className="tw-flex tw-items-center tw-justify-between tw-gap-2">
          <div className="tw-flex tw-items-center tw-gap-2">
            <FileText className="tw-size-5" />
            Context Loading
            <Button
              size="sm"
              variant="ghost2"
              className="tw-size-6 tw-p-0 tw-text-muted"
              title="Edit Context"
              onClick={() => onEditContext?.()}
            >
              <ChevronRight className="tw-size-4" />
              <span className="tw-sr-only">Edit Context</span>
            </Button>
          </div>
          <div className="tw-flex tw-items-center tw-gap-2 tw-rounded tw-p-1">
            <Button
              size="sm"
              variant="ghost2"
              className="tw-size-6 tw-p-0 tw-text-muted"
              title="Close Progress Bar"
              onClick={() => setHiddenCard(true)}
            >
              <X className="tw-size-4" />
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="tw-space-y-6">
        {/* Total progress display */}
        <div className="tw-space-y-2">
          <div className="tw-flex tw-items-center tw-justify-between tw-text-sm">
            <div className="tw-flex tw-items-center tw-gap-2">
              <span className="tw-text-muted">Total progress</span>
              <span className="tw-text-xs tw-text-muted">
                (Success:{" "}
                <span className="tw-font-medium tw-text-success">{successFiles.length}</span>,
                Failed: <span className="tw-font-medium tw-text-error">{failedFiles.length}</span>)
              </span>
            </div>
            <span className="tw-font-medium">
              {processedFilesLen}/{totalFiles.length} ({progressPercentage}%)
            </span>
          </div>
          <Progress value={progressPercentage} className="tw-h-2" />
        </div>

        {/* Currently processing file */}
        {processingFiles.length > 0 && (
          <div className="tw-space-y-3">
            <div
              className="tw--m-1 tw-flex tw-cursor-pointer tw-items-center tw-gap-2 tw-rounded-md tw-p-1 tw-transition-colors hover:tw-bg-muted/10"
              onClick={() => setIsProcessingExpanded(!isProcessingExpanded)}
            >
              <Loader2 className="tw-size-4 tw-animate-spin tw-text-accent" />
              <span className="tw-text-sm tw-font-medium">Processing</span>
              {isProcessingExpanded ? (
                <ChevronDown className="tw-ml-auto tw-size-4" />
              ) : (
                <ChevronRight className="tw-ml-auto tw-size-4" />
              )}
            </div>

            {isProcessingExpanded && (
              <div className="tw-max-h-32 tw-space-y-2 tw-overflow-y-auto">
                {processingFiles.map((fileName, index) => (
                  <div
                    key={index}
                    className="tw-flex tw-items-center tw-gap-2 tw-rounded-md tw-p-2 tw-text-sm tw-bg-faint/10"
                  >
                    <div className="tw-size-2 tw-animate-pulse tw-rounded-full tw-bg-interactive-accent" />
                    <TruncatedText className="tw-flex-1" title={fileName}>
                      {fileName}
                    </TruncatedText>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Failed to process the file */}
        {failedFiles.length > 0 && (
          <div className="tw-space-y-3">
            <div className="tw-flex tw-items-center tw-gap-2">
              <div
                className="-tw-m-1 tw-flex tw-flex-1 tw-cursor-pointer tw-items-center tw-gap-2 tw-rounded-md tw-p-1 tw-transition-colors hover:tw-bg-muted/10"
                onClick={() => setIsFailedExpanded(!isFailedExpanded)}
              >
                <AlertCircle className="tw-size-4 tw-text-error" />
                <span className="tw-text-sm tw-font-medium">Failed</span>
                <Badge variant="destructive" className="tw-text-xs">
                  {failedFiles.length} files
                </Badge>
                {isFailedExpanded ? (
                  <ChevronDown className="tw-ml-auto tw-size-4" />
                ) : (
                  <ChevronRight className="tw-ml-auto tw-size-4" />
                )}
              </div>
              {/*todo(emt-lin): in the future, we can add all failed files to retry*/}
              {/*<Button
                size="sm"
                variant="ghost"
                className="tw-size-6 tw-bg-transparent tw-p-0"
                title="Retry failed files"
                onClick={(e) => {
                  e.stopPropagation();
                  // Handle retry logic
                  handleRetryAllFailed()
                }}
              >
                <RotateCcw className="tw-size-3" />
              </Button>*/}
            </div>

            {isFailedExpanded && (
              <div className="tw-max-h-32 tw-space-y-2 tw-overflow-y-auto">
                {failedFiles.map((failedItem: FailedItem, index: number) => (
                  <div
                    key={index}
                    className="tw-flex tw-items-center tw-gap-2 tw-rounded-md tw-p-2 tw-text-sm tw-bg-faint/10"
                  >
                    <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-gap-1">
                      <div className="tw-flex tw-items-center tw-gap-2">
                        <div className="tw-size-2 tw-rounded-full tw-bg-error/80" />
                        <TruncatedText className="tw-flex-1 tw-font-bold" title={failedItem.path}>
                          {getFailedItemDisplayName(failedItem)}
                        </TruncatedText>
                      </div>
                      <div className="tw-flex tw-items-center tw-gap-2">
                        <div className="tw-size-2 tw-rounded-full" />
                        {failedItem.error && (
                          <TruncatedText
                            className="tw-flex-1 tw-text-xs tw-text-error/80"
                            title={failedItem.error}
                          >
                            <span className="tw-text-sm tw-text-error">Loading Error: </span>
                            {failedItem.error}
                          </TruncatedText>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="tw-size-5 tw-p-0"
                      title={`Retry ${failedItem.type} item`}
                      onClick={async (e) => {
                        e.stopPropagation();
                        await handleRetryFailedItem(failedItem);
                      }}
                    >
                      <RotateCcw className="tw-size-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
