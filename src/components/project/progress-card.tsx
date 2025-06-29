import * as React from "react";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { FileText, Loader2, ChevronDown, ChevronRight, AlertCircle, RotateCcw } from "lucide-react";
import { useProjectContextLoad } from "@/aiParams";
import { Button } from "@/components/ui/button";

export default function ProgressCard() {
  // 使用真实的项目上下文加载状态数据
  const [contextLoadState] = useProjectContextLoad();
  const totalFiles = contextLoadState.total.length;
  const successFiles = contextLoadState.success.length;
  const failedFiles = contextLoadState.failed.length;
  const processedFiles = successFiles + failedFiles;
  const progressPercentage = totalFiles > 0 ? Math.round((processedFiles / totalFiles) * 100) : 0;

  const failedFilesList = [
    "corrupted_data.xlsx",
    "large_presentation.pptx",
    "encrypted_document.pdf",
  ];

  // 控制文件列表展开/折叠状态
  const [isProcessingExpanded, setIsProcessingExpanded] = useState(false);
  const [isFailedExpanded, setIsFailedExpanded] = useState(false);

  return (
    <Card className="tw-w-full tw-border tw-border-solid tw-border-border tw-bg-transparent tw-shadow-none">
      <CardHeader>
        <CardTitle className="tw-flex tw-items-center tw-gap-2">
          <FileText className="tw-size-5" />
          Context Loading
        </CardTitle>
      </CardHeader>
      <CardContent className="tw-space-y-6">
        {/* 总进度显示 */}
        <div className="tw-space-y-2">
          <div className="tw-flex tw-items-center tw-justify-between tw-text-sm">
            <div className="tw-flex tw-items-center tw-gap-2">
              <span className="tw-text-muted">Total progress</span>
              <span className="tw-text-xs tw-text-muted">
                (Success: <span className="tw-font-medium tw-text-success">{successFiles}</span>,
                Failed: <span className="tw-font-medium tw-text-error">{failedFiles}</span>)
              </span>
            </div>
            <span className="tw-font-medium">
              {processedFiles}/{totalFiles} ({progressPercentage}%)
            </span>
          </div>
          <Progress value={progressPercentage} className="tw-h-2" />
        </div>

        {/* 当前处理文件 */}
        <div className="tw-space-y-3">
          <div
            className="tw--m-1 tw-flex tw-cursor-pointer tw-items-center tw-gap-2 tw-rounded-md tw-p-1 tw-transition-colors hover:tw-bg-muted/10"
            onClick={() => setIsProcessingExpanded(!isProcessingExpanded)}
          >
            <Loader2 className="tw-size-4 tw-animate-spin tw-text-accent" />
            <span className="tw-text-sm tw-font-medium">Processing</span>
            <Badge variant="secondary" className="tw-text-xs  tw-bg-muted/10">
              {contextLoadState.processingFiles.length} files
            </Badge>
            {isProcessingExpanded ? (
              <ChevronDown className="tw-ml-auto tw-size-4" />
            ) : (
              <ChevronRight className="tw-ml-auto tw-size-4" />
            )}
          </div>

          {isProcessingExpanded && (
            <div className="tw-max-h-32 tw-space-y-2 tw-overflow-y-auto">
              {contextLoadState.processingFiles.map((fileName, index) => (
                <div
                  key={index}
                  className="tw-flex tw-items-center tw-gap-2 tw-rounded-md tw-p-2 tw-text-sm tw-bg-faint/10"
                >
                  <div className="tw-size-2 tw-animate-pulse tw-rounded-full tw-bg-interactive-accent" />
                  <span className="tw-flex-1 tw-truncate" title={fileName}>
                    {fileName}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 失败文件 */}
        {failedFilesList.length > 0 && (
          <div className="tw-space-y-3">
            <div className="tw-flex tw-items-center tw-gap-2">
              <div
                className="-tw-m-1 tw-flex tw-flex-1 tw-cursor-pointer tw-items-center tw-gap-2 tw-rounded-md tw-p-1 tw-transition-colors hover:tw-bg-muted/10"
                onClick={() => setIsFailedExpanded(!isFailedExpanded)}
              >
                <AlertCircle className="tw-size-4 tw-text-error" />
                <span className="tw-text-sm tw-font-medium">Failed</span>
                <Badge variant="destructive" className="tw-text-xs">
                  {failedFiles} files
                </Badge>
                {isFailedExpanded ? (
                  <ChevronDown className="tw-ml-auto tw-size-4" />
                ) : (
                  <ChevronRight className="tw-ml-auto tw-size-4" />
                )}
              </div>
              <Button
                size="sm"
                variant="default"
                className="tw-size-6 tw-bg-transparent tw-p-0"
                title="Retry failed files"
                onClick={(e) => {
                  e.stopPropagation();
                  // 处理重试逻辑
                  console.log("Retrying failed files...");
                }}
              >
                <RotateCcw className="tw-size-3" />
              </Button>
            </div>

            {isFailedExpanded && (
              <div className="tw-max-h-32 tw-space-y-2 tw-overflow-y-auto">
                {failedFilesList.map((file, index) => (
                  <div
                    key={index}
                    className="tw-flex tw-items-center tw-gap-2 tw-rounded-md tw-p-2 tw-text-sm tw-bg-faint/10"
                  >
                    <div className="tw-size-2 tw-rounded-full tw-bg-error/80" />
                    <span className="tw-flex-1 tw-truncate" title={file}>
                      {file}
                    </span>
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
