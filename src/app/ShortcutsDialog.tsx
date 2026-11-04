import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/Icon';
import { useDialogFocus } from '../ui/useDialogFocus';
import { ALT_KEY, MOD_KEY, SHORTCUT_LABELS as K } from './actions';

/** Every keyboard shortcut, grouped, with a filter. Opens with ? or from the Help menu. */
const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Tools',
    items: [
      ['Move and select', 'V'],
      ['Hand (pan)', 'H, or hold Space'],
      ['Frame', 'F'],
      ['Rectangle', 'R'],
      ['Ellipse', 'O'],
      ['Text', 'T'],
      ['Note for yourself or the AI', 'N'],
      ['Add an image', K.insertImage],
    ],
  },
  {
    title: 'Selecting',
    items: [
      ['Select all', K.selectAll],
      ['Add to selection', 'Shift + click'],
      ['Select inside a frame', `${MOD_KEY} + click`],
      ['Select parent', 'Esc or Shift+Enter'],
      ['Select children / edit text', 'Enter'],
      ['Next / previous layer', 'Tab / Shift+Tab'],
    ],
  },
  {
    title: 'Editing',
    items: [
      ['Undo', K.undo],
      ['Redo', K.redo],
      ['Copy / cut / paste', `${K.copy} / ${K.cut} / ${K.paste}`],
      ['Duplicate', K.duplicate],
      ['Delete', 'Delete or Backspace'],
      ['Group / ungroup', `${K.group} / ${K.ungroup}`],
      ['Nudge (or reorder in auto layout)', 'Arrow keys, Shift for 10px'],
      ['Bring forward / send backward', `${K.forward} / ${K.backward}`],
      ['Bring to front / send to back', `${K.front} / ${K.back}`],
      ['Lock / hide', `${K.lock} / ${K.hide}`],
      ['Duplicate while moving', `Hold ${ALT_KEY} while dragging`],
      ['Move without snapping', `Hold ${MOD_KEY} while dragging`],
    ],
  },
  {
    title: 'Layout',
    items: [
      ['Add auto layout / tidy a frame', K.addAutoLayout],
      ['Remove auto layout', K.removeAutoLayout],
      ['Align left / right', `${K.alignLeft} / ${K.alignRight}`],
      ['Align top / bottom', `${K.alignTop} / ${K.alignBottom}`],
      ['Align centre / middle', `${K.alignHCenter} / ${K.alignVCenter}`],
      ['Show distances', `Hold ${ALT_KEY}, point at a layer`],
    ],
  },
  {
    title: 'View',
    items: [
      ['Zoom in / out', `${K.zoomIn} / ${K.zoomOut}`],
      ['Zoom to 100%', K.zoom100],
      ['Zoom to fit', K.zoomFit],
      ['Zoom to selection', K.zoomSelection],
      ['Zoom with the wheel', `${MOD_KEY} + scroll`],
    ],
  },
  {
    title: 'AI',
    items: [
      ['Ask the AI', '/'],
      ['Accept the proposal', 'Enter'],
      ['Reject the proposal', `Esc or ${K.undo}`],
    ],
  },
  { title: 'Help', items: [['Keyboard shortcuts', '?']] },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const [filter, setFilter] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(dialog);
  useEffect(() => input.current?.focus(), []);
  const q = filter.trim().toLowerCase();
  const groups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter(([what, keys]) => !q || what.toLowerCase().includes(q) || keys.toLowerCase().includes(q)),
  })).filter((g) => g.items.length);
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        className="dialog glass shortcuts"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="dialog-head">
          <span className="ai-settings-title">
            <Icon name="keyboard" size={15} /> Keyboard shortcuts
          </span>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="shortcuts-filter">
          <input
            ref={input}
            type="search"
            aria-label="Find a shortcut"
            placeholder="Find a shortcut…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        {/* Focusable so the list can be scrolled from the keyboard. */}
        <div className="dialog-body shortcuts-body" tabIndex={0} role="region" aria-label="Shortcut list">
          {groups.length === 0 && <p className="ai-settings-note">No shortcut matches “{filter}”.</p>}
          {groups.map((g) => (
            <section key={g.title} aria-label={g.title}>
              <h2>{g.title}</h2>
              <dl>
                {g.items.map(([what, keys]) => (
                  <div key={what} className="shortcut-row">
                    <dt>{what}</dt>
                    <dd>
                      <kbd>{keys}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
