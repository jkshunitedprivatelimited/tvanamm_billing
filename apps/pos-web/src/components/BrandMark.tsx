/** TVANAMM roundel — cream cup, steam and a tea leaf on a deep-green disc. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="TVANAMM"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <circle cx="32" cy="32" r="31" fill="#1b5e3a" />
      <circle cx="32" cy="32" r="31" fill="none" stroke="#6fae4f" strokeWidth="3" />
      <rect x="15" y="30" width="34" height="4" rx="2" fill="#f1ede0" />
      <path
        d="M18 35h22a2 2 0 0 1 2 2v3a13 13 0 0 1-13 13h0a13 13 0 0 1-13-13v-3a2 2 0 0 1 2-2z"
        fill="#f1ede0"
      />
      <path
        d="M42 37h3a6 6 0 0 1 0 12h-2"
        fill="none"
        stroke="#f1ede0"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <path
        d="M28 25c-3-3 0-6 0-9m6 9c-3-3 0-6 0-9"
        fill="none"
        stroke="#c9a24b"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M45 16c-6 0-10 4-10 9 5 0 10-4 10-9z" fill="#6fae4f" />
    </svg>
  );
}
