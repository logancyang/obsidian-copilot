import { createProductUrl, PRODUCT_URLS } from "@/lib/productLinks";
import { useIsPreviewEnabled } from "@/plusUtils";
import { Sparkle } from "lucide-react";
import * as React from "react";

const PREVIEW_PRICING_URL = createProductUrl(PRODUCT_URLS.COPILOT_PRICING, "preview_hint");

export function PreviewHint(): React.ReactElement {
  return (
    <a
      className="tw-inline-flex tw-items-center tw-gap-1 tw-text-ui-smaller tw-text-muted hover:tw-text-normal"
      href={PREVIEW_PRICING_URL}
      rel="noopener noreferrer"
      target="_blank"
    >
      <Sparkle aria-hidden="true" className="tw-size-3.5" />
      Preview for Believers and Supporters
    </a>
  );
}

export function PreviewUpsellHint(): React.ReactElement | null {
  return useIsPreviewEnabled() ? null : <PreviewHint />;
}
