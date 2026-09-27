// src/components/bis-mark.tsx
//
// The mark of Bespoke Intelligence Solutions, the company behind Prism: a
// triangle knocked out of a disc. One path with an even-odd fill, so the
// triangle is a real hole and the mark sits on any surface; the disc paints
// currentColor, so it follows the theme through a text colour class.

const MARK_PATH = "M0 24A24 24 0 1 1 48 24A24 24 0 1 1 0 24ZM24 11.5L35.8 33L12.2 33Z";

export function BisMark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className={className}>
      <path d={MARK_PATH} fillRule="evenodd" fill="currentColor" />
    </svg>
  );
}
