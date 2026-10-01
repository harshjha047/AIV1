import { defineViewsSpec } from '@fab5/source-gate/views/spec';

export default defineViewsSpec({
  sourceId: 'invoicing',
  specVersion: 1,
  database: '<invoicing_db>',
  indexes: {
    invoices: [
      { keys: { 'dates.invoiceDate': 1 }, name: 'ai_invoice_date' },
      { keys: { status: 1, 'dates.dueDate': 1 }, name: 'ai_status_due' },
      { keys: { invoiceNumber: 1 }, name: 'ai_invoice_number' }
    ],
    emaillogs: [{ keys: { emailType: 1, sentAt: 1 }, name: 'ai_email_type_sent' }]
  }
});
