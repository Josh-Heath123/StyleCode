import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { extensionFor } from '../codegen/exporters';
import { declarationsText, screenCss, screenHtml, type LineMap } from '../codegen/html';
import { declarationsToProps, editableDeclarations, parseDeclarationText, type ColorParser } from '../codegen/parseCss';
import { screenReact } from '../codegen/react';
import { buildScreen, listScreens, screenOf, type Decl, type ElementNode, type Screen } from '../codegen/screen';
import { useEditor, useEditorState } from '../editor/react';
import { getAncestors } from '../model/document';
import { isGrid, isInFlow } from '../model/layout';
import type { DesignDocument } from '../model/types';
import { loadAssetTypes } from '../persistence/assets';
import { Icon } from '../ui/Icon';

/**
 * The code panel: the selected screen as HTML, CSS and React, with the
 * selected layer's code highlighted, and the layer's own CSS editable, so
 * code edits flow back into the design.
 */

type FileKind = 'html' | 'css' | 'tsx' | 'module';

interface CodeFile {
  kind: FileKind;
  name: string;
  language: 'html' | 'css' | 'tsx';
  content: string;
  lines: LineMap;
}

/** Image file types, so paths in the code use the same names as the export. */
function useAssetTypes(doc: DesignDocument): Map<string, string | null> | null {
  const key = useMemo(
    () =>
      [
        ...new Set(
          Object.values(doc.nodes)
            .filter((n) => n.type === 'image' && n.src)
            .map((n) => n.src),
        ),
      ]
        .sort()
        .join(','),
    [doc],
  );
  const [types, setTypes] = useState<Map<string, string | null> | null>(null);
  useEffect(() => {
    let alive = true;
    void loadAssetTypes(key ? key.split(',') : []).then((t) => alive && setTypes(t));
    return () => {
      alive = false;
    };
  }, [key]);
  return types;
}

/** Any CSS colour → hex, using the browser's own colour parser. */
const cssColorParser: ColorParser = (() => {
  let ctx: CanvasRenderingContext2D | null = null;
  return (value: string) => {
    const v = value.trim();
    if (/^transparent$/i.test(v)) return null;
    ctx ??= document.createElement('canvas').getContext('2d');
    if (!ctx) return undefined;
    // An unreadable colour leaves the previous value; try two sentinels to tell.
    const read = (sentinel: string) => {
      ctx!.fillStyle = sentinel;
      ctx!.fillStyle = v;
      return ctx!.fillStyle;
    };
    const a = read('#010203');
    const b = read('#040506');
    if (a !== b) return undefined;
    if (a.startsWith('#')) return a;
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(a);
    if (!m) return undefined;
    const hex = (n: number) => n.toString(16).padStart(2, '0');
    const alpha = m[4] === undefined ? 1 : Number(m[4]);
    if (alpha === 0) return null;
    return `#${hex(+m[1])}${hex(+m[2])}${hex(+m[3])}${alpha < 1 ? hex(Math.round(alpha * 255)) : ''}`;
  };
})();

export function CodePanel({ onPreview }: { onPreview: (screenId: string) => void }) {
  const editor = useEditor();
  const liveDoc = useEditorState((s) => s.doc);
  const selection = useEditorState((s) => s.selection);
  // Code follows the design without slowing down drags and typing.
  const doc = useDeferredValue(liveDoc);
  const types = useAssetTypes(doc);
  const [kind, setKind] = useState<FileKind>('html');
  const [lastScreen, setLastScreen] = useState<string | null>(null);

  const screens = listScreens(doc);
  const selectedScreen = selection.length ? screenOf(doc, selection[0]) : null;
  const screenId =
    selectedScreen ?? (lastScreen && screens.some((s) => s.id === lastScreen) ? lastScreen : (screens[0]?.id ?? null));
  useEffect(() => {
    if (selectedScreen) setLastScreen(selectedScreen);
  }, [selectedScreen]);

  const screen = useMemo<Screen | null>(() => {
    if (!screenId || !doc.nodes[screenId]) return null;
    const available = types ? new Set([...types].filter(([, t]) => t).map(([id]) => id)) : undefined;
    return buildScreen(doc, screenId, { availableAssets: available });
  }, [doc, screenId, types]);

  const imagePath = (asset: string) => `${asset}.${extensionFor(types?.get(asset) ?? '')}`;
  const file = useMemo<CodeFile | null>(() => {
    if (!screen) return null;
    if (kind === 'html') {
      const printed = screenHtml(screen, {
        imageUrl: (a) => `assets/${imagePath(a)}`,
        stylesheets: ['base.css', `${screen.slug}.css`],
      });
      return { kind, name: `${screen.slug}.html`, language: 'html', ...printed };
    }
    if (kind === 'css') return { kind, name: `${screen.slug}.css`, language: 'css', ...screenCss(screen) };
    const react = screenReact(screen, { imagePath: (a) => `../assets/${imagePath(a)}` });
    return kind === 'tsx'
      ? { kind, name: `${react.componentName}.tsx`, language: 'tsx', ...react.tsx }
      : { kind, name: `${react.componentName}.module.css`, language: 'css', ...react.css };
  }, [screen, kind, types]);

  if (!screen || !file) {
    return (
      <div className="panel-scroll">
        <p className="panel-empty">Draw a frame to see its code. Each top-level frame becomes a page of the exported site.</p>
      </div>
    );
  }

  const fileNames: { kind: FileKind; name: string }[] = [
    { kind: 'html', name: `${screen.slug}.html` },
    { kind: 'css', name: `${screen.slug}.css` },
    { kind: 'tsx', name: 'React' },
    { kind: 'module', name: 'React CSS' },
  ];

  return (
    <div className="code-panel">
      <div className="code-head">
        <span className="code-screen" title="The screen (top-level frame) this code is for">
          <Icon name="frame" size={13} /> {screen.name || 'Screen'}
        </span>
        <button type="button" className="text-button" onClick={() => onPreview(screen.id)}>
          <Icon name="play" size={13} /> Preview
        </button>
      </div>

      <LayerCss screen={screen} doc={doc} />

      {screen.warnings.length > 0 && (
        <div className="code-warnings">
          {screen.warnings.map((w) => (
            <div key={w.kind} className="code-warning">
              <Icon name="warning" size={13} />
              <span>{w.message}</span>
              {w.nodeIds.length > 0 && (
                <button type="button" className="link-button" onClick={() => editor.select(w.nodeIds)}>
                  Select
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="code-tabs">
        <div className="code-tab-list" role="tablist" aria-label="Files">
          {fileNames.map((f) => (
            <button
              key={f.kind}
              type="button"
              role="tab"
              aria-selected={kind === f.kind}
              className={`code-tab${kind === f.kind ? ' is-active' : ''}`}
              onClick={() => setKind(f.kind)}
            >
              {f.name}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="icon-button code-copy"
          aria-label={`Copy ${file.name}`}
          data-tip={`Copy ${file.name}`}
          data-tip-side="left"
          onClick={() =>
            navigator.clipboard.writeText(file.content).then(
              () => editor.notify(`Copied ${file.name}.`),
              () => editor.notify('Copying was blocked by the browser.', 'error'),
            )
          }
        >
          <Icon name="copy" size={14} />
        </button>
      </div>
      <CodeView
        file={file}
        selection={selection}
        depthOf={(id) => getAncestors(doc, id).length}
        onSelectLayer={(id) => editor.select([id])}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editing a layer's CSS
// ---------------------------------------------------------------------------

function findElement(el: ElementNode, id: string): ElementNode | null {
  if (el.id === id) return el;
  for (const c of el.children) {
    const found = findElement(c, id);
    if (found) return found;
  }
  return null;
}

function LayerCss({ screen, doc }: { screen: Screen; doc: DesignDocument }) {
  const editor = useEditor();
  const selection = useEditorState((s) => s.selection);
  const id = selection.length === 1 ? selection[0] : null;
  const node = id ? doc.nodes[id] : undefined;
  const element = id ? findElement(screen.root, id) : null;
  const rule = id ? screen.rules.find((r) => r.nodeId === id && !r.pseudo) : undefined;
  const editable = !!node && !!element && !!rule && element.tag !== 'input';
  const shown = useMemo<Decl[]>(
    () => (rule ? editableDeclarations(rule.decls, { screen: rule.nodeId === screen.id, type: node?.type }) : []),
    [rule, screen.id, node?.type],
  );
  const text = declarationsText(shown);
  const [draft, setDraft] = useState(text);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  // Follow the design while the field isn't being edited.
  useEffect(() => {
    if (!dirty) setDraft(text);
  }, [text, dirty]);
  useEffect(() => {
    setDirty(false);
    setErrors([]);
  }, [id]);

  if (!id || !node) return null;
  if (!editable) {
    return (
      <p className="code-note">
        {element?.tag === 'input'
          ? 'This input takes its type style from the text inside it: select that text layer to edit it.'
          : 'This layer isn\u2019t part of the exported code (it is hidden or outside a frame).'}
      </p>
    );
  }

  const apply = () => {
    const parsed = parseDeclarationText(draft);
    if (parsed.errors.length) return setErrors(parsed.errors);
    const result = declarationsToProps(node, parsed.decls, shown, {
      parseColor: cssColorParser,
      inFlow: isInFlow(doc, node),
      inGrid: isInFlow(doc, node) && isGrid(doc.nodes[node.parentId!]),
    });
    if (!result.ok) return setErrors(result.errors);
    setErrors([]);
    setDirty(false);
    if (Object.keys(result.props).length) {
      editor.apply([{ type: 'update', id: node.id, props: result.props }], { label: 'Edit CSS' });
    }
  };
  const revert = () => {
    setDraft(text);
    setDirty(false);
    setErrors([]);
  };

  return (
    <section className="layer-css" aria-label="Layer CSS">
      <div className="layer-css-head">
        <span>
          <code>.{element!.className}</code>
        </span>
        <span className="layer-css-hint">{dirty ? 'Ctrl+Enter to apply, Esc to cancel' : 'Edit to change the design'}</span>
      </div>
      <textarea
        className="layer-css-input"
        aria-label={`CSS for ${node.name || 'layer'}`}
        spellCheck={false}
        value={draft}
        rows={Math.min(14, Math.max(3, draft.split('\n').length + 1))}
        onChange={(e) => {
          setDraft(e.target.value);
          setDirty(e.target.value !== text);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            apply();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            revert();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
      />
      {errors.length > 0 && (
        <ul className="layer-css-errors" role="alert">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}
      {dirty && (
        <div className="layer-css-actions">
          <button type="button" className="text-button" onClick={revert}>
            Cancel
          </button>
          <button type="button" className="button primary" onClick={apply}>
            Apply
          </button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Code view with highlighting
// ---------------------------------------------------------------------------

function CodeView({
  file,
  selection,
  depthOf,
  onSelectLayer,
}: {
  file: CodeFile;
  selection: readonly string[];
  /** How deep a layer is, to pick the outermost of layers sharing a line (a component's usage). */
  depthOf: (id: string) => number;
  onSelectLayer: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => file.content.replace(/\n$/, '').split('\n'), [file.content]);

  const highlighted = useMemo(() => {
    const set = new Set<number>();
    for (const id of selection) for (const [from, to] of file.lines.get(id) ?? []) for (let l = from; l <= to; l++) set.add(l);
    return set;
  }, [file, selection]);

  // Bring the selected layer's code into view.
  const first = highlighted.size ? Math.min(...highlighted) : null;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || first === null) return;
    const row = el.querySelector<HTMLElement>(`[data-line="${first}"]`);
    if (!row) return;
    const top = row.offsetTop;
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - 40) el.scrollTop = Math.max(0, top - 48);
  }, [first, file.name]);

  /** The innermost layer whose code includes a line; among layers sharing it, the outermost. */
  const layerAt = (line: number): string | null => {
    let best: string | null = null;
    let span = Infinity;
    for (const [id, ranges] of file.lines) {
      for (const [from, to] of ranges) {
        if (line < from || line > to) continue;
        const size = to - from;
        if (size < span || (size === span && best !== null && depthOf(id) < depthOf(best))) {
          best = id;
          span = size;
        }
      }
    }
    return best;
  };

  return (
    <div
      className="code-view"
      ref={scrollRef}
      // Focusable so the code can be scrolled and read from the keyboard.
      tabIndex={0}
      role="region"
      aria-label={`${file.name} code`}
      onClick={(e) => {
        // Clicking code selects its layer, unless text is being selected for copying.
        if (window.getSelection()?.toString()) return;
        const row = (e.target as HTMLElement).closest<HTMLElement>('[data-line]');
        const id = row ? layerAt(Number(row.dataset.line)) : null;
        if (id) onSelectLayer(id);
      }}
    >
      <pre aria-label={file.name}>
        {lines.map((text, i) => (
          <CodeLine key={i} number={i + 1} text={text} language={file.language} on={highlighted.has(i + 1)} />
        ))}
      </pre>
    </div>
  );
}

const CodeLine = memo(function CodeLine({
  number,
  text,
  language,
  on,
}: {
  number: number;
  text: string;
  language: CodeFile['language'];
  on: boolean;
}) {
  return (
    <div className={`code-line${on ? ' is-on' : ''}`} data-line={number}>
      <span className="code-num" aria-hidden="true">
        {number}
      </span>
      <span className="code-text">{tokenize(text, language)}</span>
    </div>
  );
});

const PATTERNS: Record<CodeFile['language'], RegExp> = {
  html: /(<!--.*?-->)|(<\/?[a-zA-Z][\w-]*|\/?>)|(\s[a-zA-Z:-]+(?==))|("[^"]*")/g,
  css: /(\/\*.*?\*\/)|(@media\b|[^\s{][^{]*(?=\s*\{$))|(^\s*[a-z-]+(?=:))|(#[0-9a-fA-F]{3,8}\b|-?\d*\.?\d+(?:px|vw|%|deg)?)/g,
  tsx: /(\/\/.*$)|(<\/?[A-Za-z][\w.]*|\/?>)|(\b(?:import|from|export|default|function|return|interface|type|as)\b|\b[a-zA-Z-]+(?==))|('[^']*'|"(?:\\.|[^"\\])*")/g,
};
const CLASSES = ['tok-comment', 'tok-tag', 'tok-key', 'tok-value'];

function tokenize(text: string, language: CodeFile['language']): ReactNode[] {
  const out: ReactNode[] = [];
  const re = new RegExp(PATTERNS[language].source, 'g');
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0] === '') {
      re.lastIndex++;
      continue;
    }
    if (m.index > last) out.push(text.slice(last, m.index));
    const group = [1, 2, 3, 4].find((g) => m![g] !== undefined) ?? 4;
    out.push(
      <span key={m.index} className={CLASSES[group - 1]}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length ? out : ['\u200b'];
}
