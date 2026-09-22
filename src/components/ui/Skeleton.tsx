/**
 * src/components/ui/Skeleton.tsx
 * Loading skeleton placeholder component with smooth pulse animation.
 * Provides pre-built patterns for room cards, table rows, and generic blocks.
 */

import React from 'react';

interface SkeletonProps {
  className?: string;
  variant?: 'block' | 'text' | 'circle' | 'card';
  width?: string;
  height?: string;
  count?: number;
}

const SkeletonBase: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div
    className={`animate-pulse bg-secondary/40 rounded-xl ${className}`}
    role="status"
    aria-label="Loading..."
  />
);

export const Skeleton: React.FC<SkeletonProps> = ({
  className = '',
  variant = 'block',
  width,
  height,
  count = 1,
}) => {
  const items = Array.from({ length: count });

  if (variant === 'circle') {
    return (
      <div className="flex gap-2">
        {items.map((_, i) => (
          <SkeletonBase
            key={i}
            className={`rounded-full ${className}`}
            {...(width ? { style: { width, height: height || width } } : {})}
          />
        ))}
      </div>
    );
  }

  if (variant === 'text') {
    return (
      <div className="flex flex-col gap-2">
        {items.map((_, i) => (
          <SkeletonBase
            key={i}
            className={`h-3 rounded-lg ${i === count - 1 ? 'w-3/4' : 'w-full'} ${className}`}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((_, i) => (
        <SkeletonBase
          key={i}
          className={className}
          {...(width || height
            ? { style: { width: width || '100%', height: height || '16px' } }
            : {})}
        />
      ))}
    </div>
  );
};

/** Pre-built skeleton for a single Room Card */
export const RoomCardSkeleton: React.FC = () => (
  <div className="border-2 border-secondary/30 bg-cream/30 rounded-2xl p-3.5 min-h-[168px] flex flex-col justify-between animate-pulse">
    {/* Top: room number + tier */}
    <div className="flex justify-between items-start">
      <div className="flex flex-col gap-1.5">
        <div className="h-7 w-10 bg-secondary/40 rounded-lg" />
        <div className="h-2.5 w-16 bg-secondary/30 rounded" />
      </div>
      <div className="h-5 w-20 bg-secondary/30 rounded-md" />
    </div>

    {/* Mid: guest name + type */}
    <div className="my-2.5 flex flex-col gap-1.5">
      <div className="h-3.5 w-24 bg-secondary/40 rounded" />
      <div className="h-2.5 w-32 bg-secondary/25 rounded" />
    </div>

    {/* Bottom: status + timer */}
    <div className="flex items-center justify-between border-t border-secondary/20 pt-2">
      <div className="flex items-center gap-1.5">
        <div className="h-3 w-3 bg-secondary/40 rounded-full" />
        <div className="h-2.5 w-16 bg-secondary/30 rounded" />
      </div>
      <div className="h-5 w-14 bg-secondary/30 rounded-full" />
    </div>
  </div>
);

/** Pre-built skeleton for the full Room Grid (12 cards) */
export const RoomGridSkeleton: React.FC<{ count?: number }> = ({ count = 12 }) => (
  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
    {Array.from({ length: count }).map((_, i) => (
      <RoomCardSkeleton key={i} />
    ))}
  </div>
);

/** Pre-built skeleton for a table row */
export const TableRowSkeleton: React.FC<{ cols?: number }> = ({ cols = 5 }) => (
  <tr className="animate-pulse">
    {Array.from({ length: cols }).map((_, i) => (
      <td key={i} className="py-3 px-4">
        <div className={`h-3 bg-secondary/35 rounded ${i === 0 ? 'w-20' : i === cols - 1 ? 'w-16' : 'w-24'}`} />
      </td>
    ))}
  </tr>
);
