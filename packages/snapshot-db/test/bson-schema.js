const INT32_MAX = 2147483647;

export const bsonTypeOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'date';
  if (value instanceof Uint8Array) return 'binData';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'boolean':
      return 'bool';
    case 'number':
      return Number.isInteger(value) && Math.abs(value) <= INT32_MAX ? 'int' : 'double';
    case 'object':
      return 'object';
    default:
      return 'unknown';
  }
};

const typeMatches = (declared, value) => {
  const accepted = Array.isArray(declared) ? declared : [declared];
  const actual = bsonTypeOf(value);
  if (accepted.includes(actual)) return true;
  if (actual === 'int' && accepted.some((type) => ['long', 'double', 'decimal'].includes(type)))
    return true;
  return false;
};

export const validate = (schema, value, path = '$') => {
  const errors = [];
  if (schema.bsonType && !typeMatches(schema.bsonType, value)) {
    errors.push(`${path}: expected ${JSON.stringify(schema.bsonType)}, got ${bsonTypeOf(value)}`);
    return errors;
  }
  if (schema.enum && !schema.enum.some((option) => option === value)) {
    errors.push(`${path}: not in enum`);
  }
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: pattern`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      errors.push(`${path}: maxLength`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: maximum`);
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      errors.push(`${path}: maxItems`);
    if (schema.items)
      value.forEach((item, i) => errors.push(...validate(schema.items, item, `${path}[${i}]`)));
  }
  if (bsonTypeOf(value) === 'object') {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}.${key}: required`);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in value) errors.push(...validate(child, value[key], `${path}.${key}`));
    }
  }
  return errors;
};
