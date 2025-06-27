import * as React from "react";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { FileText, Loader2, ChevronDown, ChevronRight } from "lucide-react";

export default function ProgressCard() {
  // 示例数据
  const totalFiles = 150;
  const processedFiles = 87;
  const successFiles = 75;
  const failedFiles = 12;
  const progressPercentage = Math.round((processedFiles / totalFiles) * 100);

  const currentProcessingFiles = [
    "document_analysis_report.pdf",
    "financial_data_2024.xlsx",
    "user_feedback_survey.docx",
    "marketing_campaign_results.pptx",
  ];

  // 控制文件列表展开/折叠状态
  const [isExpanded, setIsExpanded] = useState(false);

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
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <Loader2 className="tw-size-4 tw-animate-spin tw-text-accent" />
            <span className="tw-text-sm tw-font-medium">Processing</span>
            <Badge variant="secondary" className="tw-text-xs  tw-bg-muted/10">
              {currentProcessingFiles.length} files
            </Badge>
            {isExpanded ? (
              <ChevronDown className="tw-ml-auto tw-size-4" />
            ) : (
              <ChevronRight className="tw-ml-auto tw-size-4" />
            )}
          </div>

          {isExpanded && (
            <div className="tw-max-h-32 tw-space-y-2 tw-overflow-y-auto">
              {currentProcessingFiles.map((fileName, index) => (
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
      </CardContent>
    </Card>
  );
}
