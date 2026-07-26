import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownPreview({ source }: { source: string }) {
  if (!source.trim())
    return (
      <p className="markdown-preview-empty">
        Nothing to preview yet. Choose Write to add notes.
      </p>
    );
  return (
    <div className="markdown-preview">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children, href }) => {
            const external = /^https?:\/\//i.test(href ?? "");
            return (
              <a
                href={href}
                rel={external ? "noreferrer" : undefined}
                target={external ? "_blank" : undefined}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
