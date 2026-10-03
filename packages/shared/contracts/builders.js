export const str = Object.freeze({ type: 'string', minLength: 1 });
export const nstr = Object.freeze({ type: ['string', 'null'] });
export const int = Object.freeze({ type: 'integer' });
export const nint = Object.freeze({ type: ['integer', 'null'] });
export const num = Object.freeze({ type: 'number' });
export const nnum = Object.freeze({ type: ['number', 'null'] });
export const bool = Object.freeze({ type: 'boolean' });
export const date = Object.freeze({ isDate: true });
export const ndate = Object.freeze({ anyOf: [{ isDate: true }, { type: 'null' }] });
export const email = Object.freeze({ type: 'string', pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' });

export const object = (properties, { optional = [] } = {}) => {
  const skipped = new Set(optional);
  return {
    type: 'object',
    properties,
    required: Object.keys(properties).filter((key) => !skipped.has(key)),
    additionalProperties: false
  };
};

export const nobject = (properties) => {
  const inner = object(properties);
  return { anyOf: [inner, { type: 'null' }] };
};
