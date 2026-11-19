/**
 * StyleCode's mark (docs/brand/IDENTITY.md): a warm-white square, yours, and an orange dot, the AI's. Its colours come
 * from the tokens (`.mark-square`, `.mark-dot` in app.css), like the rest of the chrome.
 */
export function Mark({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <rect className="mark-square" x="5" y="5" width="15" height="15" rx="3" fill="none" strokeWidth="2.6" />
      <circle className="mark-dot" cx="21.5" cy="21.5" r="6" />
    </svg>
  );
}
