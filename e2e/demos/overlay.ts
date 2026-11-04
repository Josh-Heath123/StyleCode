/**
 * Runs in the page while recording: draws the mouse pointer (recordings don't
 * include it), a ripple on clicks, and the keys pressed, so a GIF shows what
 * is being done. Plain typing into a field isn't shown.
 */
export function demoOverlay(): void {
  const install = () => {
    const style = document.createElement('style');
    style.textContent = `
      .demo-cursor { position: fixed; z-index: 2147483647; width: 22px; height: 22px; pointer-events: none;
        transform: translate(-3px, -2px); filter: drop-shadow(0 1px 2px rgba(0,0,0,.6)); transition: transform .08s; }
      .demo-cursor.is-down { transform: translate(-3px, -2px) scale(.88); }
      .demo-ripple { position: fixed; z-index: 2147483646; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%;
        border: 2px solid #ffa05c; pointer-events: none; animation: demo-ripple .45s ease-out forwards; }
      @keyframes demo-ripple { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.4); opacity: 0 } }
      .demo-keys { position: fixed; z-index: 2147483647; left: 50%; bottom: 96px; transform: translateX(-50%); pointer-events: none;
        display: flex; gap: 6px; transition: opacity .25s; font: 600 15px Inter, system-ui, sans-serif; }
      .demo-keys kbd { min-width: 30px; padding: 7px 11px; border-radius: 9px; background: rgba(14,18,27,.92); color: #fff;
        border: 1px solid rgba(255,255,255,.18); box-shadow: 0 8px 24px rgba(0,0,0,.45); text-align: center; font: inherit; }`;
    document.head.append(style);
    const cursor = document.createElement('div');
    cursor.className = 'demo-cursor';
    cursor.innerHTML =
      '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2.5v17.2l4.6-4.3 2.9 6.6 3-1.3-2.9-6.5h6.3z" fill="#fff" stroke="#05070c" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    cursor.style.left = '-40px';
    document.body.append(cursor);
    const keys = document.createElement('div');
    keys.className = 'demo-keys';
    keys.style.opacity = '0';
    document.body.append(keys);
    let hide: ReturnType<typeof setTimeout> | undefined;

    window.addEventListener(
      'mousemove',
      (e) => {
        cursor.style.left = `${e.clientX}px`;
        cursor.style.top = `${e.clientY}px`;
      },
      true,
    );
    window.addEventListener(
      'mousedown',
      (e) => {
        cursor.classList.add('is-down');
        const ripple = document.createElement('div');
        ripple.className = 'demo-ripple';
        ripple.style.left = `${e.clientX}px`;
        ripple.style.top = `${e.clientY}px`;
        document.body.append(ripple);
        setTimeout(() => ripple.remove(), 500);
      },
      true,
    );
    window.addEventListener('mouseup', () => cursor.classList.remove('is-down'), true);
    window.addEventListener(
      'keydown',
      (e) => {
        const el = e.target as HTMLElement;
        const typing = el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
        const special = e.key.length > 1 || e.ctrlKey || e.metaKey || e.altKey;
        if (typing && !special) return;
        if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
        const names: Record<string, string> = {
          ' ': 'Space',
          Escape: 'Esc',
          ArrowLeft: '←',
          ArrowRight: '→',
          ArrowUp: '↑',
          ArrowDown: '↓',
        };
        const parts = [
          e.ctrlKey && 'Ctrl',
          e.altKey && 'Alt',
          e.shiftKey && e.key.length > 1 && 'Shift',
          names[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key),
        ];
        if (e.shiftKey && e.key.length === 1 && /[a-z]/i.test(e.key)) parts.splice(2, 0, 'Shift');
        keys.replaceChildren(
          ...parts.filter(Boolean).map((p) => Object.assign(document.createElement('kbd'), { textContent: String(p) })),
        );
        keys.style.opacity = '1';
        clearTimeout(hide);
        hide = setTimeout(() => (keys.style.opacity = '0'), 1100);
      },
      true,
    );
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
}
