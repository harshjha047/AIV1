import Ajv from 'ajv';
import { bahikhataContracts } from './bahikhata.js';
import { crmContracts } from './crm.js';

export const CONTRACTS = Object.freeze({ ...crmContracts, ...bahikhataContracts });

const ajv = new Ajv({ allErrors: false, strict: true });
ajv.addKeyword({
  keyword: 'isDate',
  schemaType: 'boolean',
  validate: (flag, data) => !flag || (data instanceof Date && !Number.isNaN(data.getTime()))
});

const compiled = new Map();

const compile = (id) => {
  if (!compiled.has(id)) {
    const schema = CONTRACTS[id];
    if (!schema) throw new Error(`Unknown contract ${id}`);
    compiled.set(id, ajv.compile(schema));
  }
  return compiled.get(id);
};

export const listContracts = () => Object.keys(CONTRACTS);

export const validateContract = (id, value) => {
  const validate = compile(id);
  if (validate(value)) return { ok: true, reason: null };
  const [error] = validate.errors ?? [];
  const path = error?.instancePath ? error.instancePath.slice(1).replace(/\//g, '.') : '(root)';
  const detail = error?.params?.additionalProperty
    ? `unexpected property ${error.params.additionalProperty}`
    : error?.params?.missingProperty
      ? `missing property ${error.params.missingProperty}`
      : (error?.message ?? 'invalid');
  return { ok: false, reason: `${path}: ${detail}` };
};
