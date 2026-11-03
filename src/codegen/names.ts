import type { DesignNode } from '../model/types';

/**
 * Names in generated code: CSS class names from layer names, and component,
 * file and prop names derived from them.
 */

/** Names StyleCode gives new layers; they say nothing about what a layer is. */
const DEFAULT_NAME = /^(frame|rectangle|ellipse|text|image|row|column|group|layer)(\s+\d+)?$/i;

export function isDefaultName(name: string): boolean {
  return !name.trim() || DEFAULT_NAME.test(name.trim());
}

/** Lower-case words of a string, ASCII letters and digits only. */
function words(input: string): string[] {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** `Hero title` → `hero-title`. Empty if nothing usable remains. */
export function kebab(input: string, maxWords = 5): string {
  return words(input).slice(0, maxWords).join('-').slice(0, 40).replace(/-+$/, '');
}

/** `hero-title` → `heroTitle`. */
export function camel(input: string): string {
  const w = words(input);
  return w.map((part, i) => (i === 0 ? part : part[0].toUpperCase() + part.slice(1))).join('');
}

/** `hero-title` → `HeroTitle`. */
export function pascal(input: string): string {
  return words(input)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
}

const TYPE_WORDS: Record<DesignNode['type'], string> = {
  page: 'page',
  frame: 'box',
  rect: 'box',
  ellipse: 'circle',
  text: 'text',
  image: 'image',
};

/**
 * A readable class name for a layer: its own name if the user gave it one,
 * otherwise its role, its first few words of text, or what kind of box it is.
 */
export function baseClassName(node: DesignNode): string {
  if (!isDefaultName(node.name)) {
    const fromName = kebab(node.name);
    if (fromName) return fromName;
  }
  if (node.role !== 'auto') return node.role;
  if (node.type === 'text') return kebab(node.text, 3) || 'text';
  if (node.type === 'frame' && node.layout !== 'none') return node.layout;
  return TYPE_WORDS[node.type];
}

/** Hands out names, adding -2, -3… to repeats so each is unique. */
export class NameSet {
  private readonly used = new Set<string>();

  constructor(reserved: Iterable<string> = []) {
    for (const name of reserved) this.used.add(name);
  }

  take(base: string): string {
    let name = /^[a-z]/.test(base) ? base : `x-${base}`;
    if (this.used.has(name)) {
      let n = 2;
      while (this.used.has(`${name}-${n}`)) n++;
      name = `${name}-${n}`;
    }
    this.used.add(name);
    return name;
  }
}
