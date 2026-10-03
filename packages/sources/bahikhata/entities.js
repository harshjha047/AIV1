import {
  asBool,
  asDate,
  asPaise,
  asText,
  idOf,
  normalizeEmail,
  requireId,
  requireText
} from '../src/mapping.js';
import { defineEntity } from '../src/spec.js';

const SOURCE = 'bahikhata';
const OBJECT_ID_CURSOR = { time: 'updatedAt', tie: '_id', tieType: 'objectId' };

export const employees = defineEntity(SOURCE, {
  entity: 'employees',
  kind: 'identity',
  view: 'ai_users_v',
  cursor: OBJECT_ID_CURSOR,
  contract: 'bahikhata.employees',
  map: (doc) => {
    const email = normalizeEmail(doc.email);
    return {
      _id: `bahikhata:${requireId(doc._id, '_id')}`,
      sourceUserId: requireId(doc._id, '_id'),
      email,
      name: asText(doc.name) ?? email,
      sourceRole: asText(doc.role),
      active: true,
      srcCreatedAt: asDate(doc.createdAt, 'createdAt'),
      srcUpdatedAt: asDate(doc.updatedAt, 'updatedAt', { nullable: false })
    };
  }
});

export const customers = defineEntity(SOURCE, {
  entity: 'customers',
  kind: 'identity',
  view: 'ai_customers_v',
  cursor: OBJECT_ID_CURSOR,
  contract: 'bahikhata.customers',
  map: (doc, ctx) => ({
    _id: `bahikhata:${requireId(doc._id, '_id')}`,
    sourceCustomerId: requireId(doc._id, '_id'),
    crmId: idOf(doc.crmId),
    name: requireText(doc.companyName, 'companyName'),
    collectionsManagerEmployeeId: ctx.employeeId(SOURCE, idOf(doc.manager)),
    managerSourceId: idOf(doc.manager),
    availableAdvancePaise: asPaise(doc.availableAdvance, 'availableAdvance', { nullable: false }),
    active: asBool(doc.isActive),
    srcCreatedAt: asDate(doc.createdAt, 'createdAt'),
    srcUpdatedAt: asDate(doc.updatedAt, 'updatedAt', { nullable: false })
  })
});

export const ledgerEntries = defineEntity(SOURCE, {
  entity: 'ledger_entries',
  kind: 'fact',
  view: 'ai_ledger_v',
  cursor: OBJECT_ID_CURSOR,
  target: 'fact_ledger_entries',
  contract: 'bahikhata.ledger_entries',
  activityDate: 'date',
  map: (doc, ctx) => ({
    _id: `bahikhata:${requireId(doc._id, '_id')}`,
    customerId: ctx.customerId(SOURCE, idOf(doc.customer)),
    customerSourceId: idOf(doc.customer),
    date: asDate(doc.date, 'date', { nullable: false }),
    invoiceNo: asText(doc.invoiceNo),
    debitPaise: asPaise(doc.debit, 'debit', { nullable: false }),
    creditPaise: asPaise(doc.credit, 'credit', { nullable: false }),
    advancePaise: asPaise(doc.advanceAmount, 'advanceAmount', { nullable: false }),
    amountPaidPaise: asPaise(doc.amountPaid, 'amountPaid', { nullable: false }),
    balanceDuePaise: asPaise(doc.balanceDue, 'balanceDue', { nullable: false }),
    status: asText(doc.status),
    paymentStatus: asText(doc.paymentStatus),
    addedByEmployeeId: ctx.employeeId(SOURCE, idOf(doc.addedBy)),
    addedBySourceId: idOf(doc.addedBy),
    descriptionSnippet: asText(doc.descriptionSnippet, 200),
    srcCreatedAt: asDate(doc.createdAt, 'createdAt'),
    srcUpdatedAt: asDate(doc.updatedAt, 'updatedAt', { nullable: false })
  })
});

export const bahikhataEntities = Object.freeze({
  employees,
  customers,
  ledger_entries: ledgerEntries
});
