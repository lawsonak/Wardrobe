// Renders either:
//   - a custom user-uploaded mannequin illustration (via `src` prop), or
//   - a neutral SVG silhouette as a fallback.
//
// Sized to viewBox 0 0 100 200 so the canvas can size against any
// container. When `src` is set we still wrap in the same SVG so existing
// callers don't need to change their absolute-positioned layout math.
export default function MannequinSilhouette({
  className,
  src,
}: {
  className?: string;
  src?: string | null;
}) {
  if (src) {
    return (
      // Plain <img> keeps caching/lazy-load behavior consistent with item
      // photos elsewhere in the app and avoids the SVG-image CORS quirks
      // some browsers have with <foreignObject>.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt="Your mannequin"
        className={className}
        style={{ objectFit: "contain", objectPosition: "center" }}
        draggable={false}
      />
    );
  }

  return (
    <svg viewBox="0 0 100 200" preserveAspectRatio="xMidYMid meet" className={className}>
      <defs>
        <linearGradient id="m-bg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#fdfaf6" />
          <stop offset="100%" stopColor="#f8f1e7" />
        </linearGradient>
      </defs>
      <rect width="100" height="200" fill="url(#m-bg)" />
      <g fill="#e6dccd" stroke="#cdbea6" strokeWidth="0.5" strokeLinejoin="round">
        {/* Head */}
        <ellipse cx="50" cy="20" rx="9" ry="11" />
        {/* Neck */}
        <rect x="46" y="29" width="8" height="6" rx="1.5" />
        {/* Shoulders + torso */}
        <path d="M28 38 Q50 33 72 38 L70 95 Q50 100 30 95 Z" />
        {/* Arms */}
        <path d="M28 39 Q22 60 25 95 Q22 110 22 130 Q22 138 26 138 Q28 130 28 110 Q31 80 33 50 Z" />
        <path d="M72 39 Q78 60 75 95 Q78 110 78 130 Q78 138 74 138 Q72 130 72 110 Q69 80 67 50 Z" />
        {/* Hips → legs */}
        <path d="M30 95 Q50 100 70 95 L66 130 Q58 132 52 132 L52 195 Q48 197 46 195 L46 132 Q42 132 34 130 Z" />
        {/* Feet */}
        <path d="M44 195 L52 195 L53 199 L43 199 Z" />
        <path d="M48 195 L56 195 L57 199 L47 199 Z" />
      </g>
    </svg>
  );
}
