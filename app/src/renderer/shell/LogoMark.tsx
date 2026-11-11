/** The mcpx mark (same geometry as assets/logo.svg), drawn in the current text colour. */
export function LogoMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={(size * 93) / 100} viewBox="0 0 100 93" aria-hidden focusable="false">
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="8.5">
        <line x1="50" y1="29" x2="50" y2="41" />
        <path d="M 50 41 H 24 Q 11 41 11 54 V 70" />
        <line x1="50" y1="41" x2="50" y2="70" />
        <path d="M 50 41 H 76 Q 89 41 89 54 V 70" />
      </g>
      <circle cx="50" cy="15" r="14" fill="currentColor" />
      <circle cx="11" cy="81.5" r="11.5" fill="currentColor" />
      <circle cx="50" cy="81.5" r="11.5" fill="currentColor" />
      <circle cx="89" cy="81.5" r="11.5" fill="currentColor" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <span className="wordmark__mark"><LogoMark size={16} /></span>
      <span className="wordmark__text">mcp<span className="wordmark__x">x</span></span>
    </span>
  );
}
