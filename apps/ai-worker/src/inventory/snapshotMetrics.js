import { monthKey } from '@fab5/shared/periods';
import {
  ACTIVATION_ACTION,
  APPROVED_STATUS,
  EMPLOYEE_SOURCE_FIELDS,
  FLAGS,
  IDENTITY_SYNC,
  MAPPING_STATUSES,
  MAPPING_SYSTEMS
} from './constants.js';

const SNAPSHOT_MAX_TIME_MS = 20000;
const CRM = 'crm';
const BAHIKHATA = 'bahikhata';

const live = (sourceId) => ({ _src: sourceId, _deleted: { $ne: true } });

const addActivity = (map, employeeId, date) => {
  if (!employeeId || !(date instanceof Date) || Number.isNaN(date.getTime())) return;
  const months = map.get(employeeId) ?? new Set();
  months.add(monthKey(date));
  map.set(employeeId, months);
};

async function each(collection, filter, projection, visit) {
  for await (const doc of collection.find(filter, { projection })) visit(doc);
}

export function createSnapshotMetrics({ db }) {
  const collection = (name) => db.collection(name);
  const count = (name, filter) =>
    collection(name).countDocuments(filter, { maxTimeMS: SNAPSHOT_MAX_TIME_MS });

  function session() {
    let factsPromise = null;
    const coverage = new Map();

    async function buildFacts() {
      const targets = new Set();
      await each(
        collection('fact_sales_targets'),
        live(CRM),
        { employeeId: 1, monthKey: 1 },
        (doc) => {
          if (doc.employeeId && doc.monthKey) targets.add(`${doc.employeeId}:${doc.monthKey}`);
        }
      );

      const salesActivity = new Map();
      const knownConnections = new Set();
      const connectionsWithoutCreator = new Set();
      let noTargetConnections = 0;
      await each(
        collection('fact_connections'),
        live(CRM),
        { _id: 1, createdByEmployeeId: 1, srcCreatedAt: 1 },
        (doc) => {
          knownConnections.add(doc._id);
          if (!doc.createdByEmployeeId) {
            connectionsWithoutCreator.add(doc._id);
            return;
          }
          if (!(doc.srcCreatedAt instanceof Date)) return;
          addActivity(salesActivity, doc.createdByEmployeeId, doc.srcCreatedAt);
          if (!targets.has(`${doc.createdByEmployeeId}:${monthKey(doc.srcCreatedAt)}`)) {
            noTargetConnections += 1;
          }
        }
      );

      let activationsWithoutCreator = 0;
      await each(
        collection('fact_connection_events'),
        live(CRM),
        { connectionId: 1, action: 1, performedByEmployeeId: 1, date: 1 },
        (doc) => {
          addActivity(salesActivity, doc.performedByEmployeeId, doc.date);
          if (
            doc.action === ACTIVATION_ACTION &&
            (!knownConnections.has(doc.connectionId) ||
              connectionsWithoutCreator.has(doc.connectionId))
          ) {
            activationsWithoutCreator += 1;
          }
        }
      );

      let employeesWithActivityNoTarget = 0;
      for (const [employeeId, months] of salesActivity) {
        if ([...months].some((month) => !targets.has(`${employeeId}:${month}`))) {
          employeesWithActivityNoTarget += 1;
        }
      }

      const managerByCustomer = new Map();
      await each(
        collection('customers'),
        { collectionsManagerEmployeeId: { $ne: null } },
        { _id: 1, collectionsManagerEmployeeId: 1 },
        (doc) => managerByCustomer.set(doc._id, doc.collectionsManagerEmployeeId)
      );
      const collectionsActivity = new Map();
      await each(
        collection('fact_ledger_entries'),
        live(BAHIKHATA),
        { customerId: 1, date: 1, addedByEmployeeId: 1 },
        (doc) => {
          addActivity(collectionsActivity, doc.addedByEmployeeId, doc.date);
          addActivity(collectionsActivity, managerByCustomer.get(doc.customerId), doc.date);
        }
      );

      return {
        targets,
        salesActivity,
        collectionsActivity,
        noTargetConnections,
        activationsWithoutCreator,
        employeesWithActivityNoTarget
      };
    }

    const facts = () => {
      factsPromise ??= buildFacts();
      return factsPromise;
    };

    async function syncedRows(sourceId, spec) {
      if (spec.target) return count(spec.target, live(sourceId));
      const identity = IDENTITY_SYNC[`${sourceId}.${spec.entity}`];
      if (!identity) return 0;
      return count(identity.collection, { [identity.field]: { $exists: true, $ne: null } });
    }

    async function employeesInOneSystemOnly(spec, sourceId) {
      const key = IDENTITY_SYNC[`${sourceId}.${spec.entity}`]?.field.split('.').pop();
      if (!key) return 0;
      let total = 0;
      await each(collection('employees'), {}, { sources: 1 }, (doc) => {
        const present = EMPLOYEE_SOURCE_FIELDS.filter(
          (field) => doc.sources?.[field] !== undefined && doc.sources?.[field] !== null
        );
        if (present.length === 1 && present[0] === key) total += 1;
      });
      return total;
    }

    async function flagsFor(sourceId, spec) {
      switch (`${sourceId}.${spec.entity}`) {
        case 'crm.connections': {
          const known = await facts();
          return {
            [FLAGS.BANDWIDTH_UNPARSED]: await count(spec.target, {
              ...live(sourceId),
              bandwidthParsed: false,
              bandwidthRaw: { $ne: null }
            }),
            [FLAGS.NO_CUSTOMER_MAPPING]: await count(spec.target, {
              ...live(sourceId),
              customerId: null
            }),
            [FLAGS.NO_TARGET_FOR_MONTH]: known.noTargetConnections
          };
        }
        case 'crm.connection_events':
          return {
            [FLAGS.ACTIVATIONS_WITHOUT_CREATOR]: (await facts()).activationsWithoutCreator
          };
        case 'crm.sales_targets':
          return {
            [FLAGS.EMPLOYEES_WITH_ACTIVITY_NO_TARGET]: (await facts()).employeesWithActivityNoTarget
          };
        case 'crm.service_requests':
          return {
            [FLAGS.NO_CUSTOMER_MAPPING]: await count(spec.target, {
              ...live(sourceId),
              customerId: null
            })
          };
        case 'crm.customers':
          return {
            [FLAGS.NO_MANAGER]: await count('customers', {
              'sources.crmId': { $ne: null },
              managedByEmployeeId: null
            }),
            [FLAGS.UNMAPPED_BETWEEN_SYSTEMS]: await count('customers', {
              'sources.crmId': { $ne: null },
              'sources.bahikhataId': null
            })
          };
        case 'bahikhata.customers':
          return {
            [FLAGS.NO_MANAGER]: await count('customers', {
              'sources.bahikhataId': { $ne: null },
              collectionsManagerEmployeeId: null
            }),
            [FLAGS.UNMAPPED_BETWEEN_SYSTEMS]: await count('customers', {
              'sources.bahikhataId': { $ne: null },
              'sources.crmId': null
            })
          };
        case 'bahikhata.ledger_entries':
          return {
            [FLAGS.PENDING_UNAPPROVED]: await count(spec.target, {
              ...live(sourceId),
              status: { $ne: APPROVED_STATUS }
            }),
            [FLAGS.NO_CUSTOMER_MAPPING]: await count(spec.target, {
              ...live(sourceId),
              customerId: null
            })
          };
        case 'crm.employees':
        case 'bahikhata.employees':
          return {
            [FLAGS.PRESENT_IN_ONE_SYSTEM_ONLY]: await employeesInOneSystemOnly(spec, sourceId)
          };
        default:
          return {};
      }
    }

    async function buildCoverage(spec) {
      if (spec.entity === 'employees') {
        return {
          complete: await count('employees', { mappingStatus: 'complete' }),
          partial: await count('employees', { mappingStatus: 'partial' })
        };
      }
      if (spec.entity === 'customers') {
        const bySystem = {};
        for (const system of MAPPING_SYSTEMS) {
          const statuses = {};
          let total = 0;
          for (const status of MAPPING_STATUSES) {
            statuses[status] = await count('customers', { [`mapping.${system}.status`]: status });
            total += statuses[status];
          }
          if (total > 0) bySystem[system] = statuses;
        }
        return bySystem;
      }
      return null;
    }

    function mappingCoverage(spec) {
      if (spec.entity !== 'employees' && spec.entity !== 'customers') return Promise.resolve(null);
      if (!coverage.has(spec.entity)) coverage.set(spec.entity, buildCoverage(spec));
      return coverage.get(spec.entity);
    }

    return { facts, syncedRows, flagsFor, mappingCoverage };
  }

  return { session };
}
