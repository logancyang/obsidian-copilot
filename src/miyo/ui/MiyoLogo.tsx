import { cn } from "@/lib/utils";
import React from "react";

interface MiyoLogoProps {
  className?: string;
}

export const MiyoLogo: React.FC<MiyoLogoProps> = ({ className }) => (
  <svg
    viewBox="112 55 408 502"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className={cn("tw-shrink-0", className)}
  >
    <path
      fill="currentColor"
      d="M122.2 99.2Q96 59 144 59L468 59Q516 59 516 107Q516 155 468 155L284 155L368 285.8Q381 306 368 326.2L284 457L468 457Q516 457 516 505Q516 553 468 553L144 553Q96 553 122.2 512.8L243.9 326.1Q257 306 243.9 285.9Z"
    />
  </svg>
);
