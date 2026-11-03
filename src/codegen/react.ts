import { camel, kebab, pascal } from './names';
import { screenCss, type LineMap, type Printed } from './html';
import type { Decl, ElementNode, Rule, Screen } from './screen';

/**
 * Printing a screen as a React component (TypeScript, with a CSS module).
 *
 * Repeated structures (three feature cards, a row of buttons) become one
 * component used several times. Two subtrees count as the same structure
 * when their elements and styles match; what differs between them (text,
 * images, alt text, placeholders, and fill or text colours) becomes props.
 * Colours are passed as CSS custom properties, so the styles stay in the
 * stylesheet.
 */

export interface ReactOptions {
  /** Import path for an image asset, relative to the screen's file. */
  imagePath: (asset: string) => string;
  /** Names the screen's component must not take (other screens, names App.tsx uses). */
  reserved?: ReadonlySet<string>;
}

export interface ReactScreen {
  componentName: string;
  tsx: Printed;
  css: Printed;
}

/** Properties whose values may differ between instances of a component (as CSS variables). */
const VARIABLE_PROPS = new Set(['background', 'color']);

/**
 * Names a prop can't have: JavaScript's reserved words, React's special
 * props, and the names the file itself uses (the stylesheet `s`, image
 * imports `image1`…), which a prop would hide inside the component.
 */
const RESERVED = new Set(
  (
    'break case catch class const continue debugger default delete do else enum export extends false finally for ' +
    'function if import in instanceof new null return super switch this throw true try typeof var void while with ' +
    'yield let static implements interface package private protected public await arguments eval undefined NaN ' +
    'Infinity key ref children style className props s'
  ).split(' '),
);
const isReserved = (name: string) => RESERVED.has(name) || /^image\d+$/.test(name);

interface Slot {
  kind: 'text' | 'asset' | 'attr' | 'var';
  /** Path of child indexes from the component's root element. */
  path: number[];
  attr?: string;
  prop?: string;
  /** Values per instance. */
  values: string[];
  name: string;
  cssVar?: string;
}

interface Component {
  name: string;
  signature: string;
  instances: ElementNode[];
  slots: Slot[];
}

export function screenReact(screen: Screen, options: ReactOptions): ReactScreen {
  const componentName = uniqueComponentName(pascal(screen.slug) || 'Screen', new Set(options.reserved));
  const rulesById = new Map<string, Rule[]>();
  for (const rule of [...screen.rules, ...screen.responsive]) {
    const list = rulesById.get(rule.nodeId) ?? [];
    list.push(rule);
    rulesById.set(rule.nodeId, list);
  }

  // CSS-module class names: camelCase, unique.
  const classNames = new Map<string, string>();
  const takenClasses = new Set<string>();
  const moduleClass = (className: string) => {
    let name = classNames.get(className);
    if (name) return name;
    const base = camel(className) || 'box';
    name = base;
    for (let n = 2; takenClasses.has(name); n++) name = `${base}${n}`;
    takenClasses.add(name);
    classNames.set(className, name);
    return name;
  };

  const components = findComponents(screen.root, rulesById);
  const usedNames = new Set([componentName]);
  for (const c of components) {
    c.name = uniqueComponentName(c.name, usedNames);
    // The component's root gets the component's name as its class.
    const base = camel(c.name);
    let name = base;
    for (let n = 2; takenClasses.has(name); n++) name = `${base}${n}`;
    takenClasses.add(name);
    classNames.set(c.instances[0].className, name);
  }
  const instanceOf = new Map<ElementNode, Component>();
  for (const c of components) for (const inst of c.instances) instanceOf.set(inst, c);

  // Images become imports.
  const imageImports = new Map<string, string>();
  const imageIdentifier = (asset: string) => {
    let id = imageImports.get(asset);
    if (!id) {
      id = `image${imageImports.size + 1}`;
      imageImports.set(asset, id);
    }
    return id;
  };

  // Elements inside instances other than a component's template don't get rules of their own.
  const skipped = new Set<string>();
  const varDecls = new Map<string, Map<string, string>>(); // nodeId → prop → var name
  for (const c of components) {
    c.instances.slice(1).forEach((inst) => collectIds(inst, skipped));
    for (const slot of c.slots) {
      if (slot.kind !== 'var') continue;
      const el = at(c.instances[0], slot.path);
      const map = varDecls.get(el.id) ?? new Map<string, string>();
      map.set(slot.attr!, slot.cssVar!);
      varDecls.set(el.id, map);
    }
  }

  // ---- TSX ---------------------------------------------------------------
  const lines: string[] = [];
  const lineMap: LineMap = new Map();
  const mark = (id: string, from: number, to: number) => {
    if (!id) return;
    const r = lineMap.get(id) ?? [];
    r.push([from, to]);
    lineMap.set(id, r);
  };

  const attrsFor = (el: ElementNode, slotsHere: Slot[] | null): string[] => {
    const out: string[] = [];
    out.push(el.className === 'display-contents' ? 'className="display-contents"' : `className={s.${moduleClass(el.className)}}`);
    if (el.asset) {
      const slot = slotsHere?.find((sl) => sl.kind === 'asset');
      out.push(`src={${slot ? slot.name : imageIdentifier(el.asset)}}`);
    }
    for (const [name, value] of el.attrs) {
      const slot = slotsHere?.find((sl) => sl.kind === 'attr' && sl.attr === name);
      out.push(`${name}=${slot ? `{${slot.name}}` : jsxString(value)}`);
    }
    const vars = slotsHere?.filter((sl) => sl.kind === 'var') ?? [];
    if (vars.length) {
      out.push(`style={{ ${vars.map((v) => `'--${v.cssVar}': ${v.name}`).join(', ')} } as CSSProperties}`);
    }
    return out;
  };

  /** Prints an element; `slotsAt` gives the component slots for elements of a template. */
  const printElement = (el: ElementNode, indent: string, slotsAt: ((el: ElementNode) => Slot[]) | null): void => {
    const start = lines.length + 1;
    const comp = slotsAt ? undefined : instanceOf.get(el);
    if (comp) {
      const i = comp.instances.indexOf(el);
      const props = comp.slots.map((slot) => {
        const value = slot.values[i];
        if (slot.kind === 'asset') return `${slot.name}={${imageIdentifier(value)}}`;
        return `${slot.name}=${jsxString(value)}`;
      });
      lines.push(`${indent}<${comp.name}${props.length ? ` ${props.join(' ')}` : ''} />`);
      markTree(el, start, start);
      return;
    }
    const slotsHere = slotsAt ? slotsAt(el) : null;
    const attrs = attrsFor(el, slotsHere);
    const open = `<${el.tag} ${attrs.join(' ')}`;
    if (el.tag === 'img' || el.tag === 'input') {
      lines.push(`${indent}${open} />`);
    } else if (el.text !== undefined) {
      const slot = slotsHere?.find((sl) => sl.kind === 'text');
      lines.push(`${indent}${open}>${slot ? `{${slot.name}}` : jsxText(el.text)}</${el.tag}>`);
    } else if (el.children.length === 0) {
      lines.push(`${indent}${open} />`);
    } else {
      lines.push(`${indent}${open}>`);
      for (const child of el.children) printElement(child, `${indent}  `, slotsAt);
      lines.push(`${indent}</${el.tag}>`);
    }
    mark(el.id, start, lines.length);
  };

  /** Every layer in an instance points at its usage line. */
  const markTree = (el: ElementNode, from: number, to: number) => {
    mark(el.id, from, to);
    el.children.forEach((c) => markTree(c, from, to));
  };

  const usesVars = components.some((c) => c.slots.some((sl) => sl.kind === 'var'));
  if (usesVars) lines.push("import type { CSSProperties } from 'react';");
  lines.push(`import s from './${componentName}.module.css';`);
  const importsAt = lines.length;
  lines.push('');

  for (const c of components) {
    const template = c.instances[0];
    lines.push(`interface ${c.name}Props {`);
    for (const slot of c.slots) lines.push(`  ${slot.name}: string;`);
    lines.push('}', '');
    const params = c.slots.length ? `{ ${c.slots.map((sl) => sl.name).join(', ')} }: ${c.name}Props` : '';
    lines.push(`function ${c.name}(${params}) {`, '  return (');
    const slotsByElement = new Map<ElementNode, Slot[]>();
    for (const slot of c.slots) {
      const el = at(template, slot.path);
      const list = slotsByElement.get(el) ?? [];
      list.push(slot);
      slotsByElement.set(el, list);
    }
    printElement(template, '    ', (el) => slotsByElement.get(el) ?? []);
    lines.push('  );', '}', '');
  }

  lines.push(`export default function ${componentName}() {`, '  return (');
  printElement(screen.root, '    ', null);
  lines.push('  );', '}');

  // Image imports go after the stylesheet import; shift the line map to match.
  const imports = [...imageImports].map(([asset, id]) => `import ${id} from '${options.imagePath(asset)}';`);
  if (imports.length) {
    lines.splice(importsAt, 0, ...imports);
    for (const ranges of lineMap.values()) {
      for (const range of ranges) {
        range[0] += imports.length;
        range[1] += imports.length;
      }
    }
  }

  // ---- CSS module ----------------------------------------------------------
  const keep = (rule: Rule) => !skipped.has(rule.nodeId);
  const withVars = (rule: Rule): Rule => {
    const vars = varDecls.get(rule.nodeId);
    if (!vars || rule.pseudo) return rule;
    return {
      ...rule,
      decls: rule.decls.map((d): Decl => (vars.has(d.prop) ? { prop: d.prop, value: `var(--${vars.get(d.prop)})` } : d)),
    };
  };
  const moduleScreen: Screen = {
    ...screen,
    rules: screen.rules.filter(keep).map(withVars),
    responsive: screen.responsive.filter(keep),
  };
  const css = screenCss(
    moduleScreen,
    (rule) => `.${moduleClass(rule.className)}${rule.pseudo ?? ''}`,
    `body:has(.${moduleClass(screen.root.className)})`,
  );

  return { componentName, tsx: { content: `${lines.join('\n')}\n`, lines: lineMap }, css };
}

// ---------------------------------------------------------------------------
// Finding repeated structures
// ---------------------------------------------------------------------------

function collectIds(el: ElementNode, into: Set<string>): void {
  if (el.id) into.add(el.id);
  el.children.forEach((c) => collectIds(c, into));
}

function at(root: ElementNode, path: number[]): ElementNode {
  return path.reduce((el, i) => el.children[i], root);
}

function size(el: ElementNode): number {
  return 1 + el.children.reduce((sum, c) => sum + size(c), 0);
}

/**
 * A structure's signature: everything that must match for two subtrees to be
 * one component. Text, images, alt text, placeholders and colours may differ.
 */
function signature(el: ElementNode, rulesById: Map<string, Rule[]>, cache: Map<ElementNode, string>): string {
  const cached = cache.get(el);
  if (cached) return cached;
  const rules = (rulesById.get(el.id) ?? [])
    .map(
      (r) =>
        `${r.pseudo ?? ''}{${r.decls.map((d) => `${d.prop}:${VARIABLE_PROPS.has(d.prop) && !r.pseudo ? '*' : d.value}`).join(';')}}`,
    )
    .join('');
  const attrs = el.attrs
    .filter(([name]) => name !== 'alt' && name !== 'placeholder' && name !== 'aria-label')
    .map(([n, v]) => `${n}=${v}`)
    .join(',');
  const sig = `${el.tag}[${attrs}]${el.asset ? 'img' : ''}${el.text !== undefined ? 'T' : ''}${el.className === 'display-contents' ? 'C' : ''}${rules}(${el.children.map((c) => signature(c, rulesById, cache)).join('|')})`;
  cache.set(el, sig);
  return sig;
}

function findComponents(root: ElementNode, rulesById: Map<string, Rule[]>): Component[] {
  const cache = new Map<ElementNode, string>();
  const rejected = new Set<string>();

  // Pick instances top-down: the largest repeated structures win, and nothing inside an
  // instance is considered again. A structure left with a single instance is dropped
  // and the search repeats without it.
  for (let pass = 0; pass < 10; pass++) {
    const counts = new Map<string, number>();
    const count = (el: ElementNode) => {
      if (el !== root) {
        const sig = signature(el, rulesById, cache);
        counts.set(sig, (counts.get(sig) ?? 0) + 1);
      }
      el.children.forEach(count);
    };
    count(root);

    const groups = new Map<string, ElementNode[]>();
    const pick = (el: ElementNode) => {
      if (el !== root && el.id) {
        const sig = signature(el, rulesById, cache);
        if (!rejected.has(sig) && (counts.get(sig) ?? 0) >= 2 && size(el) >= 2) {
          const list = groups.get(sig) ?? [];
          list.push(el);
          groups.set(sig, list);
          return;
        }
      }
      el.children.forEach(pick);
    };
    pick(root);

    const single = [...groups].filter(([, list]) => list.length < 2);
    if (single.length === 0) {
      return [...groups].map(([sig, instances]) => ({
        name: componentNameFor(instances),
        signature: sig,
        instances,
        slots: slotsFor(instances, rulesById),
      }));
    }
    for (const [sig] of single) rejected.add(sig);
  }
  return [];
}

/** The props of a component: whatever differs between its instances. */
function slotsFor(instances: ElementNode[], rulesById: Map<string, Rule[]>): Slot[] {
  const slots: Slot[] = [];
  const names = new Set<string>();
  const propName = (base: string, suffix = '') => {
    let name = camel(`${base} ${suffix}`) || 'value';
    if (isReserved(name) || /^[0-9]/.test(name)) name = `${name}Value`;
    let candidate = name;
    for (let n = 2; names.has(candidate); n++) candidate = `${name}${n}`;
    names.add(candidate);
    return candidate;
  };

  const visit = (path: number[]) => {
    const els = instances.map((inst) => at(inst, path));
    const first = els[0];
    const differs = (values: string[]) => values.some((v) => v !== values[0]);
    // Name props after the layer when its instances share a name (title, title-2…); a name made
    // from each instance's own text (tag-as-you-go, shared-by-default) says nothing as a prop.
    const names = new Set(els.map((e) => e.className.replace(/-\d+$/, '')));
    const named = (generic: string) => (names.size === 1 ? first.className.replace(/-\d+$/, '') : generic);
    if (first.text !== undefined) {
      const values = els.map((e) => e.text ?? '');
      if (differs(values)) slots.push({ kind: 'text', path, values, name: propName(named('text')) });
    }
    if (first.asset) {
      const values = els.map((e) => e.asset ?? '');
      if (differs(values)) slots.push({ kind: 'asset', path, values, name: propName(named('image'), 'src') });
    }
    first.attrs.forEach(([attr], i) => {
      if (attr !== 'alt' && attr !== 'placeholder' && attr !== 'aria-label') return;
      const values = els.map((e) => e.attrs[i]?.[1] ?? '');
      if (differs(values)) slots.push({ kind: 'attr', path, attr, values, name: propName(named(first.tag), attr) });
    });
    // Colours that differ are passed in as CSS variables.
    const baseRule = (e: ElementNode) => rulesById.get(e.id)?.find((r) => !r.pseudo);
    for (const decl of baseRule(first)?.decls ?? []) {
      if (!VARIABLE_PROPS.has(decl.prop)) continue;
      const values = els.map((e) => baseRule(e)?.decls.find((d) => d.prop === decl.prop)?.value ?? '');
      if (!differs(values)) continue;
      const name = propName(named(first.tag === 'div' ? 'box' : first.tag), decl.prop);
      slots.push({ kind: 'var', path, attr: decl.prop, values, name, cssVar: kebab(name) });
    }
    first.children.forEach((_, i) => visit([...path, i]));
  };
  visit([]);
  return slots;
}

/**
 * A name for a component from what its instances are called: the words their
 * class names share at the end (`tag-card`, `price-card` → `Card`) or start,
 * otherwise the first instance's name.
 */
function componentNameFor(instances: ElementNode[]): string {
  const words = instances.map((i) => i.className.replace(/-\d+$/, '').split('-'));
  const shared = (pick: (w: string[], i: number) => string | undefined) => {
    const out: string[] = [];
    for (let i = 0; ; i++) {
      const word = pick(words[0], i);
      if (!word || !words.every((w) => pick(w, i) === word)) return out;
      out.push(word);
    }
  };
  const suffix = shared((w, i) => w[w.length - 1 - i]).reverse();
  const prefix = shared((w, i) => w[i]);
  const best = suffix.length >= prefix.length ? suffix : prefix;
  const name = pascal(best.join(' ')) || pascal(instances[0].className);
  return name || 'Item';
}

function uniqueComponentName(base: string, used: Set<string>): string {
  const clean = /^[A-Z]/.test(base) ? base : `X${base}`;
  let name = clean;
  for (let n = 2; used.has(name); n++) name = `${clean}${n}`;
  used.add(name);
  return name;
}

// ---------------------------------------------------------------------------
// JSX text and attribute values
// ---------------------------------------------------------------------------

function jsxText(text: string): string {
  // Plain text when JSX keeps it exactly; otherwise a string expression.
  if (text && /^[^{}<>&\n\r\t"'\\]*$/.test(text) && text === text.trim() && !/ {2}/.test(text)) return text;
  return `{${JSON.stringify(text)}}`;
}

function jsxString(value: string): string {
  // Attribute strings in JSX decode entities, so `&` goes through a string expression too.
  if (/^[^"{}&\\\n\r]*$/.test(value)) return `"${value}"`;
  return `{${JSON.stringify(value)}}`;
}
