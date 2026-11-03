/**
 * Whether a string can be used as a layer id. Ids are map keys, so names that
 * collide with built-in object properties ("constructor", "__proto__") are
 * refused, as are long or unusual strings (ids may come from an AI model).
 */
export function isValidId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) && !(id in Object.prototype);
}

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short random identifiers. 10 base-36 characters gives ~51 bits of entropy. */
export function createId(prefix = 'n'): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % 36];
  return `${prefix}_${out}`;
}
