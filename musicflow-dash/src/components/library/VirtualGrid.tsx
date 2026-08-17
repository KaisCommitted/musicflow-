import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useScrollContainer } from "@/lib/scrollContainer";

/** Virtualizes a responsive `repeat(auto-fill, minmax(minColWidth, 1fr))` grid of
 * same-height cards, the same way SongTable virtualizes its rows — only the rows
 * scrolled into view get mounted. Needed once a library has hundreds of albums/artists
 * (nothing caps how many distinct album/artist tags a folder can contain, and sparse
 * metadata from downloaded tracks means that count can approach the song count itself):
 * mounting every card at once, each running its own entrance animation, is what made
 * switching into these tabs measurably janky. */
export function VirtualGrid<T>({
  items,
  minColWidth,
  gap,
  rowHeight,
  renderItem,
}: {
  items: T[];
  /** Matches the CSS minmax() column floor these grids used before virtualization. */
  minColWidth: number;
  /** Gap in px — only used to estimate the column count; actual spacing comes from the
   * `gap-5` class on the row so it still scales with the UI-size setting. */
  gap: number;
  /** Estimated card height in px (content + row gap); corrected post-mount via measureElement. */
  rowHeight: number;
  renderItem: (item: T, index: number) => ReactNode;
}) {
  const scrollRef = useScrollContainer();
  const containerRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const measure = () => {
      const width = containerRef.current?.clientWidth ?? 0;
      setColumns(Math.max(1, Math.floor((width + gap) / (minColWidth + gap))));
      setScrollMargin(containerRef.current?.offsetTop ?? 0);
    };
    measure();
    const container = scrollRef?.current;
    if (!container) return;
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, [scrollRef, gap, minColWidth]);

  const rowCount = Math.ceil(items.length / columns);
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: () => rowHeight,
    overscan: 3,
    scrollMargin,
  });

  return (
    <div ref={containerRef} className="relative" style={{ height: rowVirtualizer.getTotalSize() }}>
      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
        const start = virtualRow.index * columns;
        const rowItems = items.slice(start, start + columns);
        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={rowVirtualizer.measureElement}
            className="absolute left-0 top-0 grid w-full gap-5 pb-5"
            style={{
              transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)`,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            }}
          >
            {rowItems.map((item, i) => renderItem(item, start + i))}
          </div>
        );
      })}
    </div>
  );
}
