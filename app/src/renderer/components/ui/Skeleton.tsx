import "./Skeleton.css";

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: "sm" | "md" | "full";
}

export function Skeleton({ width = "100%", height = 12, radius = "sm" }: SkeletonProps) {
  return <span className={`ui-skeleton ui-skeleton--${radius}`} style={{ width, height }} aria-hidden />;
}

/** Placeholder rows shaped like ListRow, announced once as "Loading". */
export function SkeletonList({ rows = 4, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div className="ui-skeleton-list" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <div className="ui-skeleton-list__row" key={index}>
          <Skeleton width={28} height={28} radius="md" />
          <div className="ui-skeleton-list__text">
            <Skeleton width={`${38 + ((index * 17) % 30)}%`} height={11} />
            <Skeleton width={`${22 + ((index * 23) % 25)}%`} height={9} />
          </div>
          <Skeleton width={30} height={18} radius="full" />
        </div>
      ))}
    </div>
  );
}
