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
      {/* With nothing listed below it, such as while Copilot Navigator and Relevant Notes sit in the side panels, the
          greeting and message box center in the view instead of leaving its lower part empty.
          https://github.com/Brevilabs/obsidian-copilot-private/issues/804 */}
      <div className={shelf ? "tw-h-1/5 tw-shrink-0" : "tw-flex-1"} />
      <div className="tw-shrink-0 tw-pb-7">{hero}</div>
      <div className="tw-shrink-0">{composer}</div>
      {floating ? <div className="tw-shrink-0">{floating}</div> : null}
      {context ? <div className="tw-shrink-0">{context}</div> : null}
      {shelf ? (
        <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-pt-6">{shelf}</div>
      ) : (
        <div className="tw-flex-1" />
      )}
    </>
  );
}
