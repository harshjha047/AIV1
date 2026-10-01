import { ALLOWED_EMAIL_TYPES, matchDeniedKey } from './denyList.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const snippet = (name, field, length) => ({ name, reads: [field], expr: { op: 'snippet', field, length } });

const usersView = (collection = 'users', extra = []) => ({
  entity: 'employees',
  collection,
  include: ['name', 'email', 'role', ...extra, 'createdAt', 'updatedAt'],
  computed: [],
  neverExported: ['password', 'dob', 'phone', 'adharNumber', 'panNumber', 'resetPasswordToken', 'refreshToken']
});

export const VIEW_ALLOW_LISTS = deepFreeze({
  crm: {
    engine: 'mongodb',
    status: 'confirmed',
    views: {
      ai_users_v: {
        ...usersView('users', ['isActive']),
        neverExported: [
          'password',
          'dob',
          'phone',
          'adharNumber',
          'panNumber',
          'resetPasswordToken',
          'refreshToken',
          'resetPasswordExpires',
          'refreshTokenExpires'
        ]
      },
      ai_customers_v: {
        entity: 'customers',
        collection: 'customers',
        include: ['name', 'customerType', 'managedBy', 'isActive', 'createdAt', 'updatedAt'],
        computed: [
          {
            name: 'state',
            reads: ['billingProfile.address.state'],
            expr: { op: 'firstOf', field: 'billingProfile.address.state' }
          }
        ],
        neverExported: ['email', 'mobile', 'person', 'documents', 'gstNumber', 'address.street', 'address.city', 'address.pincode']
      },
      ai_connections_v: {
        entity: 'connections',
        collection: 'connections',
        include: [
          'opportunityId',
          'customer',
          'createdBy',
          'approvedBy',
          'activatedBy',
          'serviceType',
          'bandwidth',
          'status',
          'acceptanceDate',
          'technicalDetails.telcoProvider',
          'technicalDetails.aEnd.btsId',
          'technicalDetails.bEnd.btsId',
          'commercials.mrc',
          'commercials.otc',
          'providerCost.mrc',
          'ips.count',
          'ips.cost',
          'createdAt',
          'updatedAt'
        ],
        computed: [
          snippet('remarksSnippet', 'remarks', 300),
          {
            name: 'termination',
            reads: [
              'terminationDetails.raiseDate',
              'terminationDetails.finalDate',
              'terminationDetails.reason'
            ],
            expr: {
              op: 'object',
              fields: {
                raiseDate: { op: 'ref', field: 'terminationDetails.raiseDate' },
                finalDate: { op: 'ref', field: 'terminationDetails.finalDate' },
                reasonSnippet: { op: 'snippet', field: 'terminationDetails.reason', length: 300 }
              }
            }
          },
          {
            name: 'rejection',
            reads: ['rejectionDetails.rejectedAt', 'rejectionDetails.reason'],
            expr: {
              op: 'object',
              fields: {
                rejectedAt: { op: 'ref', field: 'rejectionDetails.rejectedAt' },
                reasonSnippet: { op: 'snippet', field: 'rejectionDetails.reason', length: 300 }
              }
            }
          }
        ],
        neverExported: [
          'technicalDetails.aEnd.address',
          'technicalDetails.bEnd.address',
          'technicalDetails.aEnd.coordinates',
          'technicalDetails.bEnd.coordinates',
          'purchaseOrder',
          'purchaseOrders',
          'caf',
          'businessAgreement'
        ]
      },
      ai_connection_events_v: {
        entity: 'connection_events',
        collection: 'connections',
        include: ['updatedAt'],
        unwind: {
          path: 'history',
          include: ['_id', 'action', 'date', 'performedBy', 'bandwidth'],
          computed: [
            { name: 'mrc', reads: ['commercials.mrc'], expr: { op: 'ref', field: 'commercials.mrc' } },
            snippet('noteSnippet', 'note', 300)
          ],
          rootAs: { connectionId: '_id', parentUpdatedAt: 'updatedAt' }
        },
        computed: [],
        neverExported: ['technicalDetails', 'terminationDetails']
      },
      ai_service_requests_v: {
        entity: 'service_requests',
        collection: 'servicerequests',
        include: [
          'customer',
          'requestType',
          'status',
          'serviceType',
          'bandwidthCurrent',
          'bandwidthRequested',
          'commercials.mrc',
          'createdBy',
          'approvedBy',
          'raiseDate',
          'finalDisconnectionDate',
          'createdAt',
          'updatedAt'
        ],
        computed: [snippet('disconnectionReasonSnippet', 'disconnectionReason', 300)],
        neverExported: ['technicalDetails.aEnd.address', 'technicalDetails.bEnd.address']
      },
      ai_sales_targets_v: {
        entity: 'sales_targets',
        collection: 'salestargets',
        include: ['employee', 'monthStart', 'targetMbps', 'setBy', 'createdAt', 'updatedAt'],
        computed: [],
        neverExported: []
      }
    }
  },
  bahikhata: {
    engine: 'mongodb',
    status: 'confirmed',
    views: {
      ai_users_v: {
        entity: 'employees',
        collection: 'users',
        include: ['name', 'email', 'role', 'createdAt', 'updatedAt'],
        computed: [],
        neverExported: ['password', 'resetPasswordToken', 'resetPasswordOtp', 'refreshToken']
      },
      ai_customers_v: {
        entity: 'customers',
        collection: 'customers',
        include: [
          'crmId',
          'companyName',
          'manager',
          'availableAdvance',
          'isActive',
          'createdAt',
          'updatedAt'
        ],
        computed: [],
        neverExported: ['address', 'gstNumber', 'email']
      },
      ai_ledger_v: {
        entity: 'ledger_entries',
        collection: 'ledgers',
        include: [
          'customer',
          'date',
          'invoiceNo',
          'debit',
          'credit',
          'advanceAmount',
          'status',
          'paymentStatus',
          'amountPaid',
          'balanceDue',
          'addedBy',
          'createdAt',
          'updatedAt'
        ],
        computed: [snippet('descriptionSnippet', 'description', 200)],
        neverExported: ['bankInfo', 'bankInfo.bankName', 'bankInfo.utr', 'remarks', 'allocations']
      }
    }
  },
  invoicing: {
    engine: 'mongodb',
    status: 'draft',
    views: {
      ai_users_v: {
        entity: 'employees',
        collection: 'users',
        include: ['name', 'email', 'role', 'createdAt', 'updatedAt'],
        computed: [],
        neverExported: ['password', 'resetOtp', 'resetOtpExpires']
      },
      ai_invoices_v: {
        entity: 'invoices',
        collection: 'invoices',
        include: [
          'invoiceNumber',
          'invoiceType',
          'status',
          'paymentStatus',
          'customerSnapshot.crmCustomerId',
          'customerSnapshot.name',
          'dates.invoiceDate',
          'dates.dueDate',
          'dates.cycleStart',
          'dates.cycleEnd',
          'billingConfiguration.billingMode',
          'financials.recurring',
          'financials.oneTime',
          'financials.subTotal',
          'financials.discount',
          'financials.tax',
          'financials.grandTotal',
          'financials.amountPaid',
          'financials.balanceDue',
          'reminders.firstSentAt',
          'reminders.secondSentAt',
          'reminders.suspensionSentAt',
          'reminders.lastReminderSentAt',
          'deliveryStatus',
          'email.status',
          'ledgerSyncStatus',
          'isDeleted',
          'createdAt',
          'updatedAt'
        ],
        computed: [
          { name: 'itemCount', reads: ['items'], expr: { op: 'size', field: 'items' } },
          {
            name: 'itemSourceTypes',
            reads: ['items.sourceType'],
            expr: { op: 'pluck', field: 'items', key: 'sourceType' }
          }
        ],
        neverExported: [
          'gstNumber',
          'address',
          'customerSnapshot.email',
          'deliveryHistory.email',
          'pdf',
          'items.crmConnectionSnapshot.technicalDetails'
        ]
      },
      ai_credit_notes_v: {
        entity: 'credit_notes',
        collection: 'creditnotes',
        include: [
          'creditNoteNumber',
          'invoice',
          'customer',
          'status',
          'total',
          'issueDate',
          'createdAt',
          'updatedAt'
        ],
        computed: [],
        neverExported: ['pdf', 'recipientEmails']
      },
      ai_email_logs_v: {
        entity: 'email_events',
        collection: 'emaillogs',
        include: [
          'documentType',
          'emailType',
          'documentId',
          'status',
          'subject',
          'sentAt',
          'attempts',
          'providerMessageId',
          'createdAt',
          'updatedAt'
        ],
        computed: [
          { name: 'recipientCount', reads: ['recipients'], expr: { op: 'size', field: 'recipients' } },
          {
            name: 'recipientDomains',
            reads: ['recipients'],
            expr: { op: 'domains', field: 'recipients' }
          },
          snippet('errorSnippet', 'error', 200)
        ],
        filter: { field: 'emailType', in: ALLOWED_EMAIL_TYPES },
        neverExported: ['recipients', 'to', 'cc', 'bcc', 'body', 'html']
      }
    }
  },
  samadhan: {
    engine: 'postgres',
    status: 'draft',
    views: {
      employees_v: {
        entity: 'employees',
        relation: 'employees',
        include: ['employee_pk', 'employee_id', 'user_pk', 'name', 'email', 'role', 'joined_at'],
        computed: [],
        neverExported: ['password', 'phone', 'alternate_email', 'token']
      },
      customers_v: {
        entity: 'customers',
        relation: 'customers',
        include: ['customer_pk', 'customer_id', 'name', 'joined_at'],
        computed: [],
        neverExported: ['password', 'phone', 'alternate_email', 'token']
      },
      issue_categories_v: {
        entity: 'issue_categories',
        relation: 'issue_categories',
        include: ['id', 'code', 'name', 'is_active'],
        computed: [],
        neverExported: []
      },
      tickets_v: {
        entity: 'tickets',
        relation: 'tickets',
        include: [
          'id',
          'ticket_no',
          'status',
          'customer_id',
          'current_assigned_employee_id',
          'primary_issue_category_id',
          'category_code',
          'category_name',
          'circuit_description',
          'rca',
          'problem_side',
          'telco_sr_number',
          'rating',
          'created_at',
          'updated_at',
          'resolved_at',
          'closed_at',
          'last_activity_at'
        ],
        computed: [snippet('rating_feedback_snippet', 'rating_feedback', 300)],
        neverExported: ['rca_images', 'translations']
      },
      ticket_events_v: {
        entity: 'ticket_events',
        relation: 'ticket_events',
        include: [
          'id',
          'ticket_id',
          'actor_user_id',
          'actor_employee_pk',
          'event_type',
          'new_status',
          'visible_to_customer',
          'created_at'
        ],
        computed: [snippet('message_snippet', 'message', 500)],
        neverExported: ['metadata', 'translations']
      },
      email_logs_v: {
        entity: 'email_logs',
        relation: 'automated_email_logs',
        include: ['id', 'ticket_id', 'email_type', 'sent_at'],
        computed: [],
        neverExported: ['recipient', 'body']
      }
    }
  }
});

export function listSources() {
  return Object.keys(VIEW_ALLOW_LISTS);
}

export function listViews(sourceId) {
  const source = VIEW_ALLOW_LISTS[sourceId];
  if (!source) throw new Error(`Unknown source ${sourceId}`);
  return Object.keys(source.views);
}

export function getViewAllowList(sourceId, viewName) {
  const view = VIEW_ALLOW_LISTS[sourceId]?.views?.[viewName];
  if (!view) throw new Error(`Unknown view ${sourceId}.${viewName}`);
  return view;
}

export function allowedOutputFields(view) {
  const names = [...view.include, ...view.computed.map((field) => field.name)];
  if (view.unwind) {
    names.push(
      ...view.unwind.include,
      ...view.unwind.computed.map((field) => field.name),
      ...Object.keys(view.unwind.rootAs ?? {})
    );
  }
  return names;
}

export function sourcePathsToVerify(view) {
  const paths = [...view.include];
  for (const field of view.computed) paths.push(...field.reads);
  if (view.unwind) {
    const base = view.unwind.path;
    for (const path of view.unwind.include) paths.push(`${base}.${path}`);
    for (const field of view.unwind.computed) {
      for (const read of field.reads) paths.push(`${base}.${read}`);
    }
    paths.push(...Object.values(view.unwind.rootAs ?? {}));
  }
  if (view.filter) paths.push(view.filter.field);
  return [...new Set(paths)];
}

const RAW_OPS = new Set(['ref', 'firstOf']);

function rawReads(expr) {
  if (!expr) return [];
  if (RAW_OPS.has(expr.op)) return [expr.field];
  if (expr.op === 'object') return Object.values(expr.fields).flatMap(rawReads);
  return [];
}

function overlaps(a, b) {
  return a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
}

export function validateViewSpec(view) {
  const violations = [];
  const flag = (rule, path, detail) => violations.push({ rule, path, detail });
  const candidates = [];
  for (const path of view.include ?? []) candidates.push({ path, origin: 'include' });
  for (const field of view.computed ?? []) {
    candidates.push({ path: field.name, origin: 'computed' });
    const raw = new Set(rawReads(field.expr));
    for (const read of field.reads ?? []) {
      candidates.push({ path: read, origin: 'reads', raw: raw.has(read) });
    }
    if (!field.reads || field.reads.length === 0) flag('computed_without_reads', field.name, 'missing');
  }
  if (view.unwind) {
    for (const path of view.unwind.include ?? []) {
      candidates.push({ path: `${view.unwind.path}.${path}`, origin: 'unwind' });
    }
    for (const field of view.unwind.computed ?? []) {
      candidates.push({ path: field.name, origin: 'unwind_computed' });
      const raw = new Set(rawReads(field.expr));
      for (const read of field.reads ?? []) {
        candidates.push({
          path: `${view.unwind.path}.${read}`,
          origin: 'unwind_reads',
          raw: raw.has(read)
        });
      }
    }
  }
  const seen = new Set();
  for (const { path, origin, raw } of candidates) {
    if (typeof path !== 'string' || path.length === 0) {
      flag('invalid_path', String(path), origin);
      continue;
    }
    if (/[*$]/.test(path) || path.startsWith('-')) flag('non_inclusion_path', path, origin);
    for (const segment of path.split('.')) {
      const rule = matchDeniedKey(segment);
      if (rule) {
        flag('deny_listed_key', path, `${origin}:${rule}`);
        break;
      }
    }
    if (origin === 'include' || origin === 'computed') {
      if (seen.has(path)) flag('duplicate_field', path, origin);
      seen.add(path);
    }
    for (const hidden of view.neverExported ?? []) {
      const checked = origin === 'include' || origin === 'unwind' || raw === true;
      if (checked && overlaps(path, hidden)) {
        flag('never_exported_overlap', path, hidden);
      }
    }
  }
  if (view.filter && !Array.isArray(view.filter.in)) flag('invalid_filter', view.filter.field, 'in');
  return violations;
}

export function validateAllViewSpecs() {
  const result = [];
  for (const sourceId of listSources()) {
    for (const viewName of listViews(sourceId)) {
      for (const violation of validateViewSpec(getViewAllowList(sourceId, viewName))) {
        result.push({ sourceId, view: viewName, ...violation });
      }
    }
  }
  return result;
}

export class ViewSpecViolationError extends Error {
  constructor(violations) {
    super(`View spec violations: ${violations.length}`);
    this.name = 'ViewSpecViolationError';
    this.code = 'VIEW_SPEC_VIOLATION';
    this.violations = violations;
  }
}

export function assertViewSpecClean(view) {
  const violations = validateViewSpec(view);
  if (violations.length > 0) throw new ViewSpecViolationError(violations);
  return view;
}

export function assertEntityOutputFields(sourceId, viewName, document) {
  const view = getViewAllowList(sourceId, viewName);
  const allowed = new Set(allowedOutputFields(view).map((name) => name.split('.')[0]));
  allowed.add('_id');
  return Object.keys(document).filter((key) => !allowed.has(key));
}
