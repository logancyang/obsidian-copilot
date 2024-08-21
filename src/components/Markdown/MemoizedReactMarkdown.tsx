import React, { FC, memo } from "react";
import ReactMarkdown, { Options } from "react-markdown";
import CodeBlock from "./CodeBlock"; // Adjust the import path as necessary

const MemoizedReactMarkdown: FC<Options> = memo((props) => (
  <ReactMarkdown
    {...props}
    components={{
      code({ node, inline, className, children, ...props }) {
        const match = /language-(\w+)/.exec(className || "");
        return !inline && match ? (
          <CodeBlock language={match[1]} value={String(children).replace(/\n$/, "")} />
        ) : (
          <code className={className} {...props}>
            {children}
          </code>
        );
      },
    }}
  />
));

export default MemoizedReactMarkdown;
