import { syntaxTree } from "@codemirror/language";
import {
  Prec,
  StateField,
  type EditorState,
  type Range,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { isRevealed, livePreviewReveal } from "@mdbase-dev/ui/live-preview";
import { inlineImageMediaType } from "../domain/attachment-media";

type ResolveImage = (reference: string) => Promise<Blob | null>;
type ImageCopy = Record<"attached" | "loading" | "missing" | "failed", string>;
type NotesImage = { alt: string; target: string; wiki: boolean };

const wikiImage = /^!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/;
const webLink = /^https?:\/\//i;
const rasterData = /^data:image\/(?:avif|gif|heic|heif|jpeg|png|webp)[;,]/i;
const nonCollectionUrl = /^(?:[a-z][\w+.-]*:|\/\/)/i;
const unwrapUrl = (target: string) => target.replace(/^<(.*)>$/, "$1");

function linkToOpen(event: MouseEvent, view: EditorView) {
  if (
    event.button !== 0 ||
    (view.hasFocus && !event.ctrlKey && !event.metaKey && event.detail !== 0)
  )
    return null;
  return event.target instanceof Element
    ? event.target.closest<HTMLAnchorElement>("a.task-notes-web-link")
    : null;
}

const externalLinks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!linkToOpen(event, view)) return false;
    event.preventDefault();
    return true;
  },
  click(event, view) {
    const link = linkToOpen(event, view);
    if (!link) return false;
    event.preventDefault();
    window.open(link.href, "_blank", "noopener,noreferrer");
    return true;
  },
});

export function taskNotesMarkdown(resolveImage: ResolveImage, copy: ImageCopy) {
  const decorations = (state: EditorState) => {
    const ranges: Range<Decoration>[] = [];
    const tree = syntaxTree(state);
    const definitions = new Map<string, string>();
    const key = (label: string) =>
      label.trim().replace(/\s+/g, " ").toLowerCase();
    tree.iterate({
      enter({ name, node }) {
        if (name !== "LinkReference") return;
        const label = node.getChild("LinkLabel");
        const url = node.getChild("URL");
        if (label && url) {
          const normalized = key(state.sliceDoc(label.from + 1, label.to - 1));
          if (!definitions.has(normalized))
            definitions.set(normalized, state.sliceDoc(url.from, url.to));
        }
      },
    });
    tree.iterate({
      enter({ name, from, to, node }) {
        if (name === "Image") {
          if (state.doc.lineAt(from).to < to || isRevealed(state, from, to))
            return false;
          const source = state.sliceDoc(from, to);
          const wiki = wikiImage.exec(source);
          const marks = node.getChildren("LinkMark");
          const close = marks.find(
            (mark) => state.sliceDoc(mark.from, mark.to) === "]",
          );
          const label = node.getChild("LinkLabel");
          const url = node.getChild("URL");
          const alt = close ? state.sliceDoc(from + 2, close.from) : "";
          const reference = label
            ? state.sliceDoc(label.from + 1, label.to - 1)
            : alt;
          const destination =
            wiki?.[1].trim() ??
            (url
              ? state.sliceDoc(url.from, url.to)
              : definitions.get(key(reference)));
          if (!destination) return false;
          const target = wiki ? destination : unwrapUrl(destination);
          const image = {
            alt: wiki
              ? wiki[2]?.trim() || target.replace(/^.*\//, "")
              : alt || copy.attached,
            target,
            wiki: Boolean(wiki),
          };
          ranges.push(
            Decoration.replace({
              widget: new NoteImage(image, resolveImage, copy),
            }).range(from, to),
          );
          return false;
        }
        if (name === "LinkReference") return false;
        if (name !== "Link" && name !== "Autolink" && name !== "URL") return;
        const url = name === "URL" ? node : node.getChild("URL");
        const marks = node.getChildren("LinkMark");
        const close = marks.find(
          (mark) => state.sliceDoc(mark.from, mark.to) === "]",
        );
        const label = node.getChild("LinkLabel");
        const reference = label
          ? state.sliceDoc(label.from + 1, label.to - 1)
          : close && state.sliceDoc(marks[0].to, close.from);
        const destination = url
          ? state.sliceDoc(url.from, url.to)
          : reference && definitions.get(key(reference));
        const target = destination && unwrapUrl(destination);
        if (!target || !webLink.test(target)) return false;
        const start = close ? marks[0].to : (url?.from ?? from);
        const end = close?.from ?? url?.to ?? to;
        if (start < end)
          ranges.push(
            Decoration.mark({
              tagName: "a",
              class: "task-notes-web-link",
              attributes: { href: target, target: "_blank", rel: "noreferrer" },
            }).range(start, end),
          );
        return false;
      },
    });
    return Decoration.set(ranges, true);
  };
  const field = StateField.define({
    create: decorations,
    update(previous, transaction) {
      return transaction.docChanged ||
        syntaxTree(transaction.startState) !== syntaxTree(transaction.state) ||
        transaction.startState.field(livePreviewReveal, false) !==
          transaction.state.field(livePreviewReveal, false)
        ? decorations(transaction.state)
        : previous;
    },
    provide: (source) => EditorView.decorations.from(source),
  });
  return [
    Prec.high(field),
    Prec.high(externalLinks),
    EditorView.atomicRanges.of((view) =>
      view.state.field(field).update({
        filter: (_from, _to, item) => Boolean(item.spec.widget),
      }),
    ),
  ];
}

class NoteImage extends WidgetType {
  constructor(
    readonly image: NotesImage,
    readonly resolveImage: ResolveImage,
    readonly copy: ImageCopy,
  ) {
    super();
  }

  eq(other: NoteImage): boolean {
    return (
      this.image.target === other.image.target &&
      this.image.wiki === other.image.wiki &&
      this.image.alt === other.image.alt &&
      this.resolveImage === other.resolveImage &&
      this.copy === other.copy
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const { alt, target, wiki } = this.image;
    const holder = document.createElement("span");
    holder.className = "task-notes-image";
    holder.textContent = alt;

    const status = (message: string) => {
      holder.classList.add("markdown-image-placeholder");
      holder.setAttribute("role", "img");
      holder.setAttribute("aria-label", alt);
      holder.textContent = message;
      view.requestMeasure();
    };
    const show = (url: string) => {
      holder.classList.remove("markdown-image-placeholder");
      holder.removeAttribute("role");
      holder.removeAttribute("aria-label");
      const image = document.createElement("img");
      image.alt = alt;
      image.referrerPolicy = "no-referrer";
      image.addEventListener("load", () => view.requestMeasure(), {
        once: true,
      });
      image.addEventListener("error", () => status(this.copy.failed), {
        once: true,
      });
      image.src = url;
      holder.replaceChildren(image);
    };
    const path = target.split(/[?#]/, 1)[0];
    if (!wiki && rasterData.test(target)) {
      show(target);
    } else if (inlineImageMediaType(path)) {
      if (!wiki && webLink.test(target)) {
        if (import.meta.env.MODE !== "self-hosted") show(target);
      } else if (!nonCollectionUrl.test(target)) {
        status(this.copy.loading);
        let active = true;
        let objectUrl: string | undefined;
        imageCleanups.set(holder, () => {
          active = false;
          if (objectUrl) URL.revokeObjectURL(objectUrl);
        });
        void this.resolveImage(wiki ? `[[${target}]]` : `[image](${target})`)
          .then((blob) => {
            if (!active) return;
            if (!blob) return status(this.copy.missing);
            const mediaType = inlineImageMediaType(
              path,
              blob.type === "application/octet-stream" ? undefined : blob.type,
            );
            if (!mediaType) return status(this.copy.failed);
            objectUrl = URL.createObjectURL(
              new Blob([blob], { type: mediaType }),
            );
            show(objectUrl);
          })
          .catch(() => {
            if (active) status(this.copy.missing);
          });
      }
    }
    return holder;
  }

  ignoreEvent(): boolean {
    return false;
  }

  destroy(dom: HTMLElement): void {
    imageCleanups.get(dom)?.();
  }
}

const imageCleanups = new WeakMap<HTMLElement, () => void>();
