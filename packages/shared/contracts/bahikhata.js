import { bool, date, email, int, ndate, nstr, object, str } from './builders.js';

export const bahikhataContracts = {
  'bahikhata.employees': object({
    _id: str,
    sourceUserId: str,
    email,
    name: str,
    sourceRole: nstr,
    active: bool,
    srcCreatedAt: ndate,
    srcUpdatedAt: date
  }),
  'bahikhata.customers': object({
    _id: str,
    sourceCustomerId: str,
    crmId: nstr,
    name: str,
    collectionsManagerEmployeeId: nstr,
    managerSourceId: nstr,
    availableAdvancePaise: int,
    active: bool,
    srcCreatedAt: ndate,
    srcUpdatedAt: date
  }),
  'bahikhata.ledger_entries': object({
    _id: str,
    customerId: nstr,
    customerSourceId: nstr,
    date: date,
    invoiceNo: nstr,
    debitPaise: int,
    creditPaise: int,
    advancePaise: int,
    amountPaidPaise: int,
    balanceDuePaise: int,
    status: nstr,
    paymentStatus: nstr,
    addedByEmployeeId: nstr,
    addedBySourceId: nstr,
    descriptionSnippet: nstr,
    srcCreatedAt: ndate,
    srcUpdatedAt: date
  })
};
