import React from "react";

interface ErrorBlockProps {
  errorContent: string;
}

export const ErrorBlock: React.FC<ErrorBlockProps> = ({ errorContent }) => {
  return (
    <div className="tw-my-2 tw-mb-6 tw-max-h-[180px] tw-overflow-y-scroll tw-rounded-xl tw-bg-modifier-error-rgb/5 tw-p-3">
      <div className="tw-mb-2 tw-text-sm tw-font-semibold tw-text-error">⚠️ Error occurred</div>
      <div className="tw-whitespace-pre-wrap tw-text-xs tw-text-error">{errorContent.trim()}</div>
    </div>
  );
};
