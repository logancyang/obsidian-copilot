import React from "react";

interface AgentLandingStackProps {
  hero: React.ReactNode;
  composer: React.ReactNode;
  floating?: React.ReactNode;
  context?: React.ReactNode;
  shelf?: React.ReactNode;
}

export function AgentLandingStack({
  hero,
  composer,
  floating,
  context,
  shelf,
}: AgentLandingStackProps): React.ReactElement {
  return (
    <>
      <div className="tw-h-[8%] tw-shrink-0" />
      <div className="tw-shrink-0 tw-pb-7">{hero}</div>
      <div className="tw-shrink-0">{composer}</div>
      {floating ? <div className="tw-shrink-0">{floating}</div> : null}
      {context ? <div className="tw-shrink-0">{context}</div> : null}
      {shelf ? (
        <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-pt-6">{shelf}</div>
      ) : null}
    </>
  );
}
