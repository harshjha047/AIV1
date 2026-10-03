import {
  allNull,
  asBool,
  asDate,
  asInt,
  asNumber,
  asPaise,
  asText,
  bandwidthOf,
  idOf,
  monthKeyOf,
  normalizeEmail,
  requireId,
  requireText,
  subtractPaise
} from '../src/mapping.js';
import { defineEntity } from '../src/spec.js';

const SOURCE = 'crm';
const OBJECT_ID_CURSOR = { time: 'updatedAt', tie: '_id', tieType: 'objectId' };

export const employees = defineEntity(SOURCE, {
  entity: 'employees',
  kind: 'identity',
  view: 'ai_users_v',
  cursor: OBJECT_ID_CURSOR,
  contract: 'crm.employees',
  map: (doc) => {
    const email = normalizeEmail(doc.email);
    return {
      _id: `crm:${requireId(doc._id, '_id')}`,
      sourceUserId: requireId(doc._id, '_id'),
      email,
      name: asText(doc.name) ?? email,
      sourceRole: asText(doc.role),
      active: asBool(doc.isActive),
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
  contract: 'crm.customers',
  map: (doc, ctx) => ({
    _id: `crm:${requireId(doc._id, '_id')}`,
    sourceCustomerId: requireId(doc._id, '_id'),
    name: requireText(doc.name, 'name'),
    customerType: asText(doc.customerType),
    state: asText(doc.state),
    managedByEmployeeId: ctx.employeeId(SOURCE, idOf(doc.managedBy)),
    managedBySourceId: idOf(doc.managedBy),
    active: asBool(doc.isActive),
    srcCreatedAt: asDate(doc.createdAt, 'createdAt'),
    srcUpdatedAt: asDate(doc.updatedAt, 'updatedAt', { nullable: false })
  })
});

export const connections = defineEntity(SOURCE, {
  entity: 'connections',
  kind: 'fact',
  view: 'ai_connections_v',
  cursor: OBJECT_ID_CURSOR,
  target: 'fact_connections',
  contract: 'crm.connections',
  activityDate: 'srcCreatedAt',
  map: (doc, ctx) => {
    const bandwidth = bandwidthOf(doc.bandwidth);
    const mrcPaise = asPaise(doc.commercials?.mrc, 'commercials.mrc');
    const providerMrcPaise = asPaise(doc.providerCost?.mrc, 'providerCost.mrc');
    const termination = doc.termination
      ? {
          raiseDate: asDate(doc.termination.raiseDate, 'termination.raiseDate'),
          finalDate: asDate(doc.termination.finalDate, 'termination.finalDate'),
          reasonSnippet: asText(doc.termination.reasonSnippet, 300)
        }
      : null;
    const rejection = doc.rejection
      ? {
          rejectedAt: asDate(doc.rejection.rejectedAt, 'rejection.rejectedAt'),
          reasonSnippet: asText(doc.rejection.reasonSnippet, 300)
        }
      : null;
    return {
      _id: `crm:${requireId(doc._id, '_id')}`,
      opportunityId: asText(doc.opportunityId),
      customerId: ctx.customerId(SOURCE, idOf(doc.customer)),
      customerSourceId: idOf(doc.customer),
      createdByEmployeeId: ctx.employeeId(SOURCE, idOf(doc.createdBy)),
      approvedByEmployeeId: ctx.employeeId(SOURCE, idOf(doc.approvedBy)),
      activatedByEmployeeId: ctx.employeeId(SOURCE, idOf(doc.activatedBy)),
      serviceType: asText(doc.serviceType),
      bandwidthRaw: bandwidth.raw,
      bandwidthMbps: bandwidth.mbps,
      bandwidthParsed: bandwidth.parsed,
      telcoProvider: asText(doc.technicalDetails?.telcoProvider),
      status: requireText(doc.status, 'status'),
      mrcPaise,
      otcPaise: asPaise(doc.commercials?.otc, 'commercials.otc'),
      providerMrcPaise,
      marginMrcPaise: subtractPaise(mrcPaise, providerMrcPaise),
      ipCount: asInt(doc.ips?.count, 'ips.count'),
      ipCostPaise: asPaise(doc.ips?.cost, 'ips.cost'),
      aEndBtsId: asText(doc.technicalDetails?.aEnd?.btsId),
      bEndBtsId: asText(doc.technicalDetails?.bEnd?.btsId),
      acceptanceDate: asDate(doc.acceptanceDate, 'acceptanceDate'),
      remarksSnippet: asText(doc.remarksSnippet, 300),
      termination: termination && allNull(termination) ? null : termination,
      rejection: rejection && allNull(rejection) ? null : rejection,
      srcCreatedAt: asDate(doc.createdAt, 'createdAt'),
      srcUpdatedAt: asDate(doc.updatedAt, 'updatedAt', { nullable: false })
    };
  }
});

export const connectionEvents = defineEntity(SOURCE, {
  entity: 'connection_events',
  kind: 'fact',
  view: 'ai_connection_events_v',
  cursor: { time: 'parentUpdatedAt', tie: '_id', tieType: 'objectId' },
  target: 'fact_connection_events',
  contract: 'crm.connection_events',
  activityDate: 'date',
  map: (doc, ctx) => {
    const bandwidth = bandwidthOf(doc.bandwidth);
    const connectionId = requireId(doc.connectionId, 'connectionId');
    return {
      _id: `crm:${connectionId}:${requireId(doc._id, '_id')}`,
      connectionId: `crm:${connectionId}`,
      action: requireText(doc.action, 'action'),
      date: asDate(doc.date, 'date'),
      performedByEmployeeId: ctx.employeeId(SOURCE, idOf(doc.performedBy)),
      bandwidthRaw: bandwidth.raw,
      bandwidthMbps: bandwidth.raw === null ? null : bandwidth.mbps,
      mrcPaise: asPaise(doc.mrc, 'mrc'),
      noteSnippet: asText(doc.noteSnippet, 300),
      parentUpdatedAt: asDate(doc.parentUpdatedAt, 'parentUpdatedAt', { nullable: false })
    };
  }
});

export const serviceRequests = defineEntity(SOURCE, {
  entity: 'service_requests',
  kind: 'fact',
  view: 'ai_service_requests_v',
  cursor: OBJECT_ID_CURSOR,
  target: 'fact_service_requests',
  contract: 'crm.service_requests',
  activityDate: 'srcCreatedAt',
  map: (doc, ctx) => {
    const current = bandwidthOf(doc.bandwidthCurrent);
    const requested = bandwidthOf(doc.bandwidthRequested);
    return {
      _id: `crm:${requireId(doc._id, '_id')}`,
      customerId: ctx.customerId(SOURCE, idOf(doc.customer)),
      customerSourceId: idOf(doc.customer),
      requestType: asText(doc.requestType),
      status: asText(doc.status),
      serviceType: asText(doc.serviceType),
      bandwidthCurrentMbps: current.raw === null ? null : current.mbps,
      bandwidthRequestedMbps: requested.raw === null ? null : requested.mbps,
      mrcPaise: asPaise(doc.commercials?.mrc, 'commercials.mrc'),
      createdByEmployeeId: ctx.employeeId(SOURCE, idOf(doc.createdBy)),
      approvedByEmployeeId: ctx.employeeId(SOURCE, idOf(doc.approvedBy)),
      disconnectionReasonSnippet: asText(doc.disconnectionReasonSnippet, 300),
      raiseDate: asDate(doc.raiseDate, 'raiseDate'),
      finalDisconnectionDate: asDate(doc.finalDisconnectionDate, 'finalDisconnectionDate'),
      srcCreatedAt: asDate(doc.createdAt, 'createdAt'),
      srcUpdatedAt: asDate(doc.updatedAt, 'updatedAt', { nullable: false })
    };
  }
});

export const salesTargets = defineEntity(SOURCE, {
  entity: 'sales_targets',
  kind: 'fact',
  view: 'ai_sales_targets_v',
  cursor: OBJECT_ID_CURSOR,
  target: 'fact_sales_targets',
  contract: 'crm.sales_targets',
  activityDate: 'monthStart',
  map: (doc, ctx) => {
    const monthStart = asDate(doc.monthStart, 'monthStart', { nullable: false });
    return {
      _id: `crm:${requireId(doc._id, '_id')}`,
      employeeId: ctx.employeeId(SOURCE, idOf(doc.employee)),
      employeeSourceId: requireId(doc.employee, 'employee'),
      monthKey: monthKeyOf(monthStart),
      monthStart,
      targetMbps: asNumber(doc.targetMbps, 'targetMbps', { nullable: false }),
      setByEmployeeId: ctx.employeeId(SOURCE, idOf(doc.setBy)),
      srcUpdatedAt: asDate(doc.updatedAt, 'updatedAt', { nullable: false })
    };
  }
});

export const crmEntities = Object.freeze({
  employees,
  customers,
  connections,
  connection_events: connectionEvents,
  service_requests: serviceRequests,
  sales_targets: salesTargets
});
