import { Badge } from "@/components/ui/badge";
import React from "react";

export function PlusSettings() {
  return (
    <section className="tw-flex tw-flex-col tw-gap-4 tw-rounded-lg tw-bg-secondary tw-p-4">
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-text-xl tw-font-bold">
        <span>Copilot Plus</span>
        <Badge variant="outline" className="tw-text-success">
          Active
        </Badge>
      </div>
      <div className="tw-flex tw-flex-col tw-gap-2 tw-text-sm tw-text-muted">
        <div>
          Copilot Plus is active with all premium features unlocked:
          <strong>
            {" "}
            chat context, PDF and image support, web search integration, exclusive chat and embedding
            models, and much more.
          </strong>
        </div>
      </div>
    </section>
  );
}
