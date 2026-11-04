import type { Tool } from '../editor/editor';
import { useEditor, useEditorState } from '../editor/react';
import { Icon, type IconName } from '../ui/Icon';
import { SHORTCUT_LABELS as K } from './actions';
import { insertImagesFromPicker } from './insert';

const TOOLS: { tool: Tool; icon: IconName; label: string; key: string }[] = [
  { tool: 'move', icon: 'move', label: 'Move', key: 'V' },
  { tool: 'hand', icon: 'hand', label: 'Hand', key: 'H' },
];

const SHAPES: { tool: Tool; icon: IconName; label: string; key: string }[] = [
  { tool: 'frame', icon: 'frame', label: 'Frame', key: 'F' },
  { tool: 'rect', icon: 'rect', label: 'Rectangle', key: 'R' },
  { tool: 'ellipse', icon: 'ellipse', label: 'Ellipse', key: 'O' },
  { tool: 'text', icon: 'text', label: 'Text', key: 'T' },
];

/** The floating tool dock at the bottom of the canvas, with the AI assistant's button at the end. */
export function Dock({ aiOpen, onToggleAi }: { aiOpen: boolean; onToggleAi: () => void }) {
  const editor = useEditor();
  const active = useEditorState((s) => s.tool);
  const button = ({ tool, icon, label, key }: (typeof TOOLS)[number]) => (
    <button
      key={tool}
      type="button"
      className={`icon-button${active === tool ? ' is-active' : ''}`}
      aria-label={`${label} (${key})`}
      aria-pressed={active === tool}
      data-tip={`${label}  ${key}`}
      data-tip-side="top"
      onClick={() => editor.setTool(tool)}
    >
      <Icon name={icon} size={18} />
    </button>
  );
  return (
    <div className="dock glass" role="toolbar" aria-label="Tools">
      {TOOLS.map(button)}
      <span className="dock-divider" />
      {SHAPES.map(button)}
      <button
        type="button"
        className="icon-button"
        aria-label={`Add image (${K.insertImage})`}
        data-tip={`Image  ${K.insertImage}`}
        data-tip-side="top"
        onClick={() => void insertImagesFromPicker(editor)}
      >
        <Icon name="image" size={18} />
      </button>
      <span className="dock-divider" />
      <button
        type="button"
        className="icon-button dock-ai"
        aria-label="Ask AI (/)"
        aria-expanded={aiOpen}
        data-tip="Ask AI  /"
        data-tip-side="top"
        onClick={onToggleAi}
      >
        <Icon name="sparkle" size={18} />
      </button>
    </div>
  );
}
