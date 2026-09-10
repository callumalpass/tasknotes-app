import {
  defaultRangeExtractor,
  measureElement,
  useWindowVirtualizer,
} from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
  className = "",
}: {
  items: readonly T[];
  getKey(item: T): string;
  renderItem(item: T, index: number): ReactNode;
  estimateSize?(item: T): number;
  relatedIndices?(index: number): number[];
  className?: string;
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
    count: items.length,
    getItemKey: itemKey,
    estimateSize: itemEstimate,
    measureElement: measureVisibleRow,
    overscan: 8,
    scrollMargin,
    rangeExtractor,
  });
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
  return (
    <div
      className={`bounded-list ${className}`}
      ref={root}
      style={{ position: "relative", height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((item) => (
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
      ))}
    </div>
  );
}
