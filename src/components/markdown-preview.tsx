import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useState } from "react";

export function MarkdownPreview({
  source,
  resolveImage,
}: {
  source: string;
  resolveImage?: (source: string) => Promise<Blob | null>;
}) {
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
          img: ({ alt, src }) => {
            if (!src || !resolveImage || /^(?:https?:|data:|blob:)/i.test(src))
              return <img alt={alt ?? ""} src={src} />;
            return (
              <ResolvedMarkdownImage
                alt={alt ?? "Attached image"}
                key={attachmentImageSource(src)}
                resolveImage={resolveImage}
                source={attachmentImageSource(src)}
              />
            );
          },
        }}
      >
        {preprocessWikilinkImages(source)}
      </ReactMarkdown>
    </div>
  );
}

function ResolvedMarkdownImage({
  alt,
  source,
  resolveImage,
}: {
  alt: string;
  source: string;
  resolveImage(source: string): Promise<Blob | null>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    void resolveImage(source)
      .then((blob) => {
        if (!active) return;
        if (!blob) {
          setMissing(true);
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setFailed(false);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setMissing(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [resolveImage, source]);
  if (url && !failed)
    return <img alt={alt} src={url} onError={() => setFailed(true)} />;
  return (
    <span className="markdown-image-placeholder" role="img" aria-label={alt}>
      {missing
        ? "Image unavailable offline"
        : failed
          ? "Image preview unavailable"
          : "Loading image…"}
    </span>
  );
}

function preprocessWikilinkImages(source: string): string {
  return source.replace(
    /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_match, rawPath: string, rawAlt: string | undefined) => {
      const path = rawPath.trim();
      const alt = (rawAlt?.trim() || path.replace(/^.*\//, ""))
        .replaceAll("[", "\\[")
        .replaceAll("]", "\\]");
      return `![${alt}](/__tasknotes_attachment__/${encodeURIComponent(path)})`;
    },
  );
}

function attachmentImageSource(source: string): string {
  const prefix = "/__tasknotes_attachment__/";
  return source.startsWith(prefix)
    ? `[[${decodeURIComponent(source.slice(prefix.length))}]]`
    : `[image](${source})`;
}
