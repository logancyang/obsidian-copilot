import * as React from "react";
import { useMemo, useState } from "react";
import { FailedItem, getCurrentProject, useProjectContextLoad } from "@/aiParams";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TruncatedText } from "@/components/TruncatedText";
import { ProcessingStatus } from "@/components/project/processing-status";
import { useProjectProcessingData } from "@/components/project/useProjectProcessingData";
import { openCachedItemPreview } from "@/utils/cacheFileOpener";
import type { ProcessingItem } from "@/components/project/processingAdapter";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { splitUrlsStringToArray } from "@/projects/projectUtils";
import CopilotPlugin from "@/main";
import { logError } from "@/logger";

interface ProgressCardProps {
  plugin?: CopilotPlugin;
  setHiddenCard: (hidden: boolean) => void;
  onEditContext?: () => void;
}

export default function ProgressCard({ plugin, setHiddenCard, onEditContext }: ProgressCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [contextLoadState] = useProjectContextLoad();
  const totalFiles = contextLoadState.total;
  const successFiles = contextLoadState.success;
  const failedFiles = contextLoadState.failed;
  const processingFiles = contextLoadState.processingFiles;

  const processedFilesLen = successFiles.length + failedFiles.length;
  const progressPercentage =
    totalFiles.length > 0 ? Math.round((processedFilesLen / totalFiles.length) * 100) : 0;

  // Reason: get current project for the shared hook — ProgressCard always shows the active project.
  const currentProject = getCurrentProject() ?? null;
  const { processingData, projectCache } = useProjectProcessingData({
    cacheProject: currentProject,
  });

  // Reason: markdown files are not in processingData (adapter skips .md files) but they
  // can still fail or be processing. Extract them so they remain visible and retryable.
  const mdProcessingFiles = useMemo(
    () => processingFiles.filter((p) => p.endsWith(".md")),
    [processingFiles]
  );
  const mdFailedFiles = useMemo(
    () => failedFiles.filter((item) => item.type === "md"),
    [failedFiles]
  );
  const hasMdItems = mdProcessingFiles.length > 0 || mdFailedFiles.length > 0;

  // Reason: determine whether the detail section has any content to show.
  // Without this, the "View Details" trigger would expand to empty space.
  const hasDetailContent = (processingData && processingData.items.length > 0) || hasMdItems;

  /** Retry a failed conversion item via processingData.failedItemMap. */
  const handleRetry = (itemId: string) => {
    if (!plugin?.projectManager || !processingData) return;
    const failedItem = processingData.failedItemMap.get(itemId);
    if (!failedItem) return;
    plugin.projectManager.retryFailedItem(failedItem).catch((error) => {
      logError(`Error retrying failed item: ${error}`);
    });
  };

  /** Retry a failed markdown item directly. */
  const handleRetryMdItem = (item: FailedItem) => {
    if (!plugin?.projectManager) return;
    plugin.projectManager.retryFailedItem(item).catch((error) => {
      logError(`Error retrying failed item: ${error}`);
    });
  };

  /** Remove a failed URL from the saved project config. */
  const handleRemoveUrl = async (item: ProcessingItem) => {
    if (!currentProject) return;
    const field = item.cacheKind === "youtube" ? "youtubeUrls" : "webUrls";
    const currentUrls = splitUrlsStringToArray(currentProject.contextSource?.[field] || "");
    const remaining = currentUrls.filter((url) => url !== item.id);
    const updatedProject = {
      ...currentProject,
      contextSource: {
        ...currentProject.contextSource,
        [field]: remaining.join("\n"),
      },
    };
    try {
      await ProjectFileManager.getInstance().updateProject(currentProject.id, updatedProject);
    } catch (error) {
      logError(`Error removing URL from project: ${error}`);
    }
  };

  /** Open parsed content preview for a cached item. */
  const handleOpenCachedItem = (item: ProcessingItem) => {
    void openCachedItemPreview(app, projectCache, item);
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
      <CardContent className="tw-space-y-4">
        {/* Progress bar — always visible, covers all files (md + non-md) */}
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

        {/* Collapsible detail section — each sub-section manages its own population */}
        {hasDetailContent && (
          <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <CollapsibleTrigger asChild>
              <Button
                variant="secondary"
                className="tw-flex tw-h-auto tw-w-full tw-items-center tw-justify-between tw-rounded-md tw-p-2 tw-text-left tw-transition-colors hover:tw-bg-modifier-hover"
              >
                <span className="tw-text-ui-smaller tw-text-muted">View Details</span>
                {isExpanded ? (
                  <ChevronDown className="tw-size-4 tw-text-muted" />
                ) : (
                  <ChevronRight className="tw-size-4 tw-text-muted" />
                )}
              </Button>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div className="tw-mt-2 tw-space-y-3">
                {/* Section 1: Content Conversion (non-markdown items — PDF, images, URLs) */}
                {processingData && processingData.items.length > 0 && (
                  <ProcessingStatus
                    items={processingData.items}
                    onRetry={handleRetry}
                    onOpenCachedItem={projectCache != null ? handleOpenCachedItem : undefined}
                    onRemoveUrl={handleRemoveUrl}
                    defaultExpanded
                    maxHeight="200px"
                  />
                )}

                {/* Section 2: Markdown Files (processing + failed only) */}
                {hasMdItems && (
                  <div className="tw-space-y-1.5">
                    <div className="tw-flex tw-items-center tw-gap-1.5 tw-px-1">
                      <FileText className="tw-size-3.5 tw-text-muted" />
                      <span className="tw-text-ui-smaller tw-font-medium tw-text-muted">
                        Markdown Files
                      </span>
                      {mdProcessingFiles.length > 0 && (
                        <Badge
                          variant="secondary"
                          className="tw-h-4 tw-gap-0.5 tw-px-1 tw-text-[10px]"
                        >
                          <Loader2 className="tw-size-2.5 tw-animate-spin" />
                          {mdProcessingFiles.length}
                        </Badge>
                      )}
                      {mdFailedFiles.length > 0 && (
                        <Badge
                          variant="secondary"
                          className="tw-h-4 tw-gap-0.5 tw-bg-error tw-px-1 tw-text-[10px] tw-text-error"
                        >
                          <AlertCircle className="tw-size-2.5" />
                          {mdFailedFiles.length}
                        </Badge>
                      )}
                    </div>
                    {mdProcessingFiles.map((path, i) => (
                      <div
                        key={`md-proc-${i}`}
                        className="tw-flex tw-items-center tw-gap-2 tw-rounded-md tw-border tw-border-border tw-bg-primary tw-p-2"
                      >
                        <Loader2 className="tw-size-3.5 tw-animate-spin tw-text-loading" />
                        <TruncatedText
                          className="tw-flex-1 tw-text-ui-smaller tw-text-normal"
                          title={path}
                        >
                          {path}
                        </TruncatedText>
                      </div>
                    ))}
                    {mdFailedFiles.map((item, i) => (
                      <div
                        key={`md-fail-${i}`}
                        className="tw-rounded-md tw-border tw-border-border tw-bg-primary tw-p-2"
                      >
                        <div className="tw-flex tw-items-center tw-gap-2">
                          <AlertCircle className="tw-size-3.5 tw-shrink-0 tw-text-error" />
                          <TruncatedText
                            className="tw-flex-1 tw-text-ui-smaller tw-text-normal"
                            title={item.path}
                          >
                            {item.path}
                          </TruncatedText>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="tw-h-5 tw-shrink-0 tw-px-1.5 tw-text-ui-smaller"
                            title="Retry"
                            onClick={() => handleRetryMdItem(item)}
                          >
                            <RefreshCw className="tw-mr-1 tw-size-3" />
                            Retry
                          </Button>
                        </div>
                        {item.error && (
                          <TruncatedText className="tw-mt-1 tw-pl-5.5 tw-text-ui-smaller tw-text-error">
                            {item.error}
                          </TruncatedText>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
