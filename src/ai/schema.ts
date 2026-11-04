import { PROPERTY_DEFS, type PropDef } from '../model/properties';
import { DESIGN_TYPES, type PropKey } from '../model/types';

/**
 * The shape of an AI reply, as a JSON schema. Providers that support it
 * constrain generation to this schema (Ollama's `format`, OpenAI's
 * `response_format`, an Anthropic tool's `input_schema`), so even small local
 * models produce well-formed operations. Everything is checked again when the
 * reply arrives; the schema only makes good replies likely.
 *
 * The schema is deliberately flat (no recursion, no `$ref`) and avoids length
 * and range limits, which some constrained decoders turn into very large
 * grammars. New layers are created one at a time and refer to each other by
 * a `ref` handle.
 */

/** Properties the AI may set. It can't lock layers, point images at stored files or touch notes. */
export const AI_PROPERTIES: readonly PropKey[] = (Object.keys(PROPERTY_DEFS) as PropKey[]).filter(
  (key) => key !== 'locked' && key !== 'src' && key !== 'noteTarget',
);

const HEX = '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$';

function propertySchema(def: PropDef): Record<string, unknown> {
  const spec = def.spec;
  switch (spec.kind) {
    case 'number':
      return { type: spec.integer ? 'integer' : 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'string':
      return { type: 'string' };
    case 'color':
      return spec.nullable ? { anyOf: [{ type: 'string', pattern: HEX }, { type: 'null' }] } : { type: 'string', pattern: HEX };
    case 'enum':
      return { type: 'string', enum: [...spec.values] };
  }
}

function setSchema(): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const key of AI_PROPERTIES) properties[key] = propertySchema(PROPERTY_DEFS[key]);
  return { type: 'object', properties, additionalProperties: false };
}

const op = (name: string, properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  properties: { op: { type: 'string', enum: [name] }, ...properties },
  required: ['op', ...required],
  additionalProperties: false,
});

export function responseSchema(): Record<string, unknown> {
  const set = setSchema();
  const id = { type: 'string' };
  const index = { type: 'integer' };
  return {
    type: 'object',
    properties: {
      explanation: { type: 'string' },
      operations: {
        type: 'array',
        items: {
          anyOf: [
            op('update', { id, set }, ['id', 'set']),
            op('create', { ref: id, parent: id, index, type: { type: 'string', enum: [...DESIGN_TYPES] }, set }, [
              'ref',
              'parent',
              'type',
              'set',
            ]),
            op('delete', { id }, ['id']),
            op('move', { id, parent: id, index }, ['id', 'parent']),
            op('tidy', { id }, ['id']),
          ],
        },
      },
    },
    required: ['explanation', 'operations'],
    additionalProperties: false,
  };
}
