import {
  defaultRangeExtractor,
  measureElement,
  useWindowVirtualizer,
} from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";

export const FOCUS_ADJACENT_TASK = "tasknotes:focus-adjacent-task";

export interface BoundedListHandle {
  reveal(key: string, selector: string, block?: ScrollLogicalPosition): void;
}

const defaultEstimate = () => 84;
// Mobile detail temporarily hides the mounted workspace. Zero is not a new row height.
const measureVisibleRow: typeof measureElement = (element, entry, instance) => {
  const size = measureElement(element, entry, instance);
  if (size > 0) return size;
  const index = instance.indexFromElement(element);
  return (
    instance.itemSizeCache.get(instance.options.getItemKey(index)) ??
    instance.options.estimateSize(index)
  );
};

/** One measured window for the whole list, not one observer/window per section.
 * Retain the last focused row while its menu/detail owns focus. No task replica.
 */
export function BoundedList<T>({
  items,
  getKey,
  renderItem,
  estimateSize = defaultEstimate,
  relatedIndices,
  taskId,
  className = "",
  group,
  navigateTasks = false,
  ref,
}: {
  items: readonly T[];
  getKey(item: T): string;
  renderItem(item: T, index: number): ReactNode;
  estimateSize?(item: T): number;
  relatedIndices?(index: number): number[];
  className?: string;
  taskId?(item: T): string | undefined;
  group?: {
    key(item: T): string;
    render(key: string, items: ReactNode[]): ReactNode;
  };
  navigateTasks?: boolean;
  ref?: Ref<BoundedListHandle>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const indexByKey = useMemo(
    () => new Map(items.map((item, index) => [getKey(item), index])),
    [items, getKey],
  );
  const focusedIndex =
    focusedKey === null ? -1 : (indexByKey.get(focusedKey) ?? -1);
  const itemKey = useCallback(
    (index: number) => getKey(items[index]),
    [getKey, items],
  );
  const itemEstimate = useCallback(
    (index: number) => estimateSize(items[index]),
    [estimateSize, items],
  );
  const rangeExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) => {
      const indices = defaultRangeExtractor(range);
      if (focusedIndex >= 0) indices.push(focusedIndex);
      if (relatedIndices)
        for (const index of [...indices])
          indices.push(...relatedIndices(index));
      return [...new Set(indices)].sort((a, b) => a - b);
    },
    [focusedIndex, relatedIndices],
  );
  const virtualizer = useWindowVirtualizer({
    // Collapsing a group can change the scroll range during React layout.
    useFlushSync: false,
    count: items.length,
    getItemKey: itemKey,
    estimateSize: itemEstimate,
    measureElement: measureVisibleRow,
    overscan: 8,
    scrollMargin,
    rangeExtractor,
  });
  const revealFrame = useRef(0);
  const reveal = useCallback(
    (
      index: number,
      selector: string,
      block: ScrollLogicalPosition = "nearest",
    ) => {
      cancelAnimationFrame(revealFrame.current);
      const key = itemKey(index);
      const wrapped = () =>
        root.current?.querySelector<HTMLDivElement>(
          `[data-bounded-key="${CSS.escape(key)}"]`,
        );
      if (!wrapped()) {
        setFocusedKey(key);
        virtualizer.scrollToIndex(index, {
          align: block === "start" ? "start" : "auto",
        });
      }
      let attempts = 0;
      const focus = () => {
        const item = wrapped();
        const target = item?.querySelector<HTMLElement>(selector);
        if (target && item) {
          target.focus({ preventScroll: true });
          item.scrollIntoView({ block });
        } else if (++attempts < 10) {
          revealFrame.current = requestAnimationFrame(focus);
        }
      };
      revealFrame.current = requestAnimationFrame(focus);
    },
    [itemKey, virtualizer],
  );
  useImperativeHandle(
    ref,
    () => ({
      reveal(key, selector, block) {
        const index = indexByKey.get(key);
        if (index !== undefined) reveal(index, selector, block);
      },
    }),
    [indexByKey, reveal],
  );
  useEffect(() => () => cancelAnimationFrame(revealFrame.current), []);

  useEffect(() => {
    const list = root.current;
    const region = root.current?.closest("[data-task-selection-list]");
    if (!region || !taskId) return;
    const revealTask = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      const index = items.findIndex((item) => taskId(item) === id);
      if (index < 0) return;
      event.stopImmediatePropagation();
      reveal(index, ".task-row-title");
    };
    const focusAdjacent = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const item = event.target.closest<HTMLElement>("[data-bounded-key]");
      const key = item?.dataset.boundedKey;
      const index = key === undefined ? undefined : indexByKey.get(key);
      if (index === undefined) return;
      event.preventDefault();
      const direction = (event as CustomEvent<1 | -1>).detail;
      for (
        let next = index + direction;
        next >= 0 && next < items.length;
        next += direction
      ) {
        if (!taskId(items[next])) continue;
        reveal(next, ".task-row-title");
        break;
      }
    };
    region.addEventListener("tasknotes:reveal-task", revealTask);
    if (navigateTasks)
      list?.addEventListener(FOCUS_ADJACENT_TASK, focusAdjacent);
    return () => {
      region.removeEventListener("tasknotes:reveal-task", revealTask);
      list?.removeEventListener(FOCUS_ADJACENT_TASK, focusAdjacent);
    };
  }, [indexByKey, items, navigateTasks, reveal, taskId]);
  useLayoutEffect(() => {
    const measure = () => {
      if (root.current?.getClientRects().length)
        setScrollMargin(
          root.current.getBoundingClientRect().top + window.scrollY,
        );
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  useEffect(() => {
    const focus = (event: Event) => {
      const item =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-bounded-key]")
          : null;
      if (item && root.current?.contains(item))
        setFocusedKey(item.dataset.boundedKey ?? null);
    };
    document.addEventListener("focusin", focus);
    document.addEventListener("pointerdown", focus);
    return () => {
      document.removeEventListener("focusin", focus);
      document.removeEventListener("pointerdown", focus);
    };
  }, []);
  const virtualItems = virtualizer.getVirtualItems();
  const renderVirtualItem = (item: (typeof virtualItems)[number]) => (
    <div
      key={item.key}
      ref={virtualizer.measureElement}
      data-index={item.index}
      data-bounded-key={getKey(items[item.index])}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        transform: `translateY(${item.start - scrollMargin}px)`,
      }}
    >
      {renderItem(items[item.index], item.index)}
    </div>
  );
  let content: ReactNode;
  if (group) {
    const mounted = new Map<string, ReactNode[]>();
    for (const item of virtualItems) {
      const key = group.key(items[item.index]);
      const children = mounted.get(key) ?? [];
      children.push(renderVirtualItem(item));
      mounted.set(key, children);
    }
    content = [...mounted].map(([key, children]) =>
      group.render(key, children),
    );
  } else content = virtualItems.map(renderVirtualItem);

  return (
    <div
      className={`bounded-list ${className}`}
      ref={root}
      style={{ position: "relative", height: virtualizer.getTotalSize() }}
    >
      {content}
    </div>
  );
}
