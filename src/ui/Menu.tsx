import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type MenuEntry =
  | { kind?: 'item'; label: string; shortcut?: string; onSelect: () => void; disabled?: boolean; danger?: boolean }
  | { kind: 'separator' }
  | { kind: 'header'; label: string };

interface MenuProps {
  entries: MenuEntry[];
  /** The element that opened the menu; presses on it are left to its own toggle. */
  anchor?: React.RefObject<HTMLElement | null>;
  /** Screen position of the menu's top-left corner. */
  at: { x: number; y: number };
  onClose: () => void;
  label: string;
  minWidth?: number;
}

/**
 * A floating menu used for dropdowns and the canvas context menu.
 * Keyboard: arrows move, Enter selects, Escape closes.
 */
export function Menu({ entries, at, onClose, label, minWidth = 200, anchor }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  const [active, setActive] = useState(-1);
  const items = entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => (e.kind ?? 'item') === 'item' && !(e as { disabled?: boolean }).disabled);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(at.x, window.innerWidth - r.width - 8);
    const y = at.y + r.height > window.innerHeight - 8 ? Math.max(8, at.y - r.height) : at.y;
    setPos({ x: Math.max(8, x), y });
    el.focus();
  }, [at.x, at.y]);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (anchor?.current?.contains(target)) return;
      if (ref.current && !ref.current.contains(target)) onClose();
    };
    const onBlur = () => onClose();
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [onClose, anchor]);

  const choose = (entry: MenuEntry) => {
    if ((entry.kind ?? 'item') !== 'item') return;
    const item = entry as Extract<MenuEntry, { onSelect: () => void }>;
    if (item.disabled) return;
    onClose();
    item.onSelect();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length === 0) return;
      const current = items.findIndex((it) => it.i === active);
      const next = e.key === 'ArrowDown' ? (current + 1) % items.length : (current - 1 + items.length) % items.length;
      setActive(items[next].i);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      choose(entries[active]);
    }
  };

  return createPortal(
    <div
      ref={ref}
      className="menu glass"
      role="menu"
      aria-label={label}
      tabIndex={-1}
      style={{ left: pos.x, top: pos.y, minWidth }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, i) => {
        if (entry.kind === 'separator') return <div key={i} className="menu-separator" role="separator" />;
        if (entry.kind === 'header')
          return (
            <div key={i} className="menu-header">
              {entry.label}
            </div>
          );
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={`menu-item${entry.danger ? ' is-danger' : ''}${active === i ? ' is-active' : ''}`}
            disabled={entry.disabled}
            onPointerEnter={() => setActive(i)}
            onClick={() => choose(entry)}
          >
            <span>{entry.label}</span>
            {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/** A button that opens a menu below itself. */
export function MenuButton({
  label,
  entries,
  children,
  className = 'icon-button',
  minWidth,
  tip,
}: {
  label: string;
  entries: () => MenuEntry[];
  children: ReactNode;
  className?: string;
  minWidth?: number;
  tip?: string;
}) {
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(null), []);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`${className}${open ? ' is-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={!!open}
        aria-label={label}
        data-tip={open ? undefined : tip}
        onClick={() => {
          if (open) return close();
          const r = ref.current!.getBoundingClientRect();
          setOpen({ x: r.left, y: r.bottom + 6 });
        }}
      >
        {children}
      </button>
      {open && <Menu label={label} entries={entries()} at={open} onClose={close} minWidth={minWidth} anchor={ref} />}
    </>
  );
}
