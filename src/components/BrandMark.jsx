// The Techomato tomato mark, shared across the Techomato apps.
export default function BrandMark({ size = 28 }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 34 34" aria-hidden="true">
      <circle cx="17" cy="19" r="14" fill="var(--brand)" />
      <path d="M13 5c2 2 6 2 8 0" stroke="var(--leaf)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M12.5 15.5 9 19l3.5 3.5M21.5 15.5 25 19l-3.5 3.5" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
