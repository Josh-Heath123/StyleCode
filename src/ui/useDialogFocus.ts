import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe:not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])';

/**
 * The menu button whose menu was last used. A dialog opened from a menu item
 * gives focus back to that button, since the menu itself is gone by the time
 * the dialog closes.
 */
let lastMenuButton: HTMLElement | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener(
    'focusin',
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || el.closest('[role="dialog"], [role="menu"]')) return;
      lastMenuButton = el.getAttribute('aria-haspopup') === 'menu' ? el : null;
    },
    true,
  );
}

/**
 * Keyboard behaviour every dialog shares: Tab and Shift+Tab stay inside it,
 * and when it closes, focus goes back to whatever opened it.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const active = document.activeElement;
    const el = ref.current;
    // Whatever had focus when the dialog opened; for a menu item (gone now), its menu's button.
    const previous =
      active instanceof HTMLElement && active !== document.body && !el?.contains(active) && !active.closest('[role="menu"]')
        ? active
        : lastMenuButton;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !el) return;
      const focusable = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      if (e.shiftKey && (current === first || current === el || !el.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !el.contains(current))) {
        e.preventDefault();
        first.focus();
      }
    };
    // Focus that leaves the dialog some other way (out of the end of an embedded page) comes back.
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (!el || !(target instanceof HTMLElement) || el.contains(target)) return;
      // A menu, or another dialog on top of this one, keeps its focus.
      if (target.closest('[role="dialog"], [role="menu"]')) return;
      const first = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].find((n) => n.getClientRects().length > 0);
      (first ?? el).focus({ preventScroll: true });
    };
    el?.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      el?.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      // Back to whatever opened it; if that is gone (a button that only showed while saving failed),
      // to the page's natural home for the keyboard.
      const home = previous?.isConnected ? previous : document.querySelector<HTMLElement>('[data-focus-home]');
      home?.focus({ preventScroll: true });
    };
  }, [ref]);
}
