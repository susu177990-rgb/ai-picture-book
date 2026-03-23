'use client';

import { useRef, useState, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

interface VirtualizedGridProps<T> {
  items: T[];
  estimateRowHeight: number;
  minColumnWidth?: number;
  gap?: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  getItemKey: (item: T, index: number) => string;
}

/**
 * 虚拟化网格：仅渲染可见行，减少 DOM 数量。
 * 需要父容器有固定高度和 overflow-y: auto。
 */
export function VirtualizedGrid<T>({
  items,
  estimateRowHeight,
  minColumnWidth = 300,
  gap = 20,
  renderItem,
  getItemKey,
}: VirtualizedGridProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(3);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const update = () => {
      const w = el.offsetWidth;
      setColumnCount(Math.max(1, Math.floor((w + gap) / (minColumnWidth + gap))));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [minColumnWidth, gap]);

  const rowCount = Math.ceil(items.length / columnCount);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is intentionally used for large image grids.
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateRowHeight + gap,
    overscan: 2,
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      style={{
        height: '60vh',
        overflow: 'auto',
        contain: 'strict',
      }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualRow) => {
          const startIdx = virtualRow.index * columnCount;
          const rowItems = items.slice(startIdx, startIdx + columnCount);
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                display: 'grid',
                gridTemplateColumns: `repeat(${columnCount}, minmax(${minColumnWidth}px, 1fr))`,
                gap,
              }}
            >
              {rowItems.map((item, colIdx) => (
                <div key={getItemKey(item, startIdx + colIdx)}>
                  {renderItem(item, startIdx + colIdx)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
