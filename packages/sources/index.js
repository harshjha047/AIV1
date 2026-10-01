import crm from './crm/views.spec.js';
import bahikhata from './bahikhata/views.spec.js';
import invoicing from './invoicing/views.spec.js';
import samadhan from './samadhan/views.spec.js';

export const viewsSpecs = Object.freeze({ crm, bahikhata, invoicing, samadhan });

export function getViewsSpec(sourceId) {
  const spec = viewsSpecs[sourceId];
  if (!spec) throw new Error(`No views spec for ${sourceId}`);
  return spec;
}
