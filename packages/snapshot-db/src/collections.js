import { COLLECTIONS, NAMESPACE_EXISTS } from './constants.js';
import { VALIDATION_OPTIONS, VALIDATORS } from './validators.js';

const optionsFor = (name) => {
  const jsonSchema = VALIDATORS[name];
  return jsonSchema ? { validator: { $jsonSchema: jsonSchema }, ...VALIDATION_OPTIONS } : {};
};

export const ensureCollections = async (db) => {
  const created = [];
  const updated = [];
  for (const name of COLLECTIONS) {
    const options = optionsFor(name);
    try {
      await db.createCollection(name, options);
      created.push(name);
    } catch (error) {
      if (error.code !== NAMESPACE_EXISTS) throw error;
      if (options.validator) {
        await db.command({ collMod: name, ...options });
        updated.push(name);
      }
    }
  }
  return { created, updated };
};
