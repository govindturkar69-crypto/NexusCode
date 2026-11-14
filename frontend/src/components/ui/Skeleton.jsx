// Placeholder shapes while content loads, with a soft shimmer (it stops with
// reduced motion). Decorative: wrap a group in an element with role="status" and a label.
function Skeleton({ width = "100%", height = 14, radius, className = "", style }) {
  return (
    <span
      className={`skeleton ${className}`}
      aria-hidden="true"
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

export function SkeletonText({ lines = 3, className = "" }) {
  return (
    <span className={`skeleton-text ${className}`} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "62%" : "100%"} height={12} />
      ))}
    </span>
  );
}

// A labelled loading region made of skeletons
export function LoadingRegion({ label = "Loading…", children, className = "" }) {
  return (
    <div role="status" aria-live="polite" className={className}>
      <span className="visually-hidden">{label}</span>
      {children}
    </div>
  );
}

export default Skeleton;
