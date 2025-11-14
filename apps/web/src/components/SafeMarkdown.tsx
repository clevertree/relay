"use client";
import React from 'react';
import ReactMarkdown from 'react-markdown';

// very conservative allowed elements
const allowed = new Set([
  'p','strong','em','code','pre','ul','ol','li','a','h1','h2','h3','h4','h5','h6','blockquote','hr'
]);

export default function SafeMarkdown({ markdown }: { markdown: string }) {
  return (
    <ReactMarkdown
      // disallow raw HTML by default in react-markdown v9
      components={{
        a: ({node, href, children, ...props}) => (
          <a {...props} href={href ?? '#'} rel="noopener noreferrer" target="_blank">{children}</a>
        ),
      }}
      allowedElements={[...allowed] as any}
      unwrapDisallowed
    >
      {markdown}
    </ReactMarkdown>
  );
}
