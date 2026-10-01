import { defineViewsSpec } from '@fab5/source-gate/views/spec';

export default defineViewsSpec({
  sourceId: 'samadhan',
  specVersion: 1,
  database: '<samadhan_db>',
  schema: 'ai_export',
  selects: {
    employees_v: {
      from: 'employees e JOIN users u ON u.id = e.user_id',
      columns: {
        employee_pk: 'e.id',
        employee_id: 'e.employee_id',
        user_pk: 'u.id',
        name: 'u.name',
        email: 'lower(u.email)',
        role: 'u.role::text',
        joined_at: 'e.joined_at'
      }
    },
    customers_v: {
      from: 'customers c JOIN users u ON u.id = c.user_id',
      columns: {
        customer_pk: 'c.id',
        customer_id: 'c.customer_id',
        name: 'u.name',
        joined_at: 'c.joined_at'
      }
    },
    issue_categories_v: {
      from: 'issue_categories',
      columns: { id: 'id', code: 'code', name: 'name', is_active: 'is_active' }
    },
    tickets_v: {
      from: 'tickets t\nLEFT JOIN issue_categories ic ON ic.id = t.primary_issue_category_id\nLEFT JOIN (SELECT ticket_id, max(created_at) AS last_event_at\n           FROM ticket_events GROUP BY ticket_id) ev ON ev.ticket_id = t.id',
      columns: {
        id: 't.id',
        ticket_no: 't.ticket_no',
        status: 't.status::text',
        customer_id: 't.customer_id',
        current_assigned_employee_id: 't.current_assigned_employee_id',
        primary_issue_category_id: 't.primary_issue_category_id',
        category_code: 'ic.code',
        category_name: 'ic.name',
        circuit_description: 't.circuit_description',
        rca: 't.rca',
        problem_side: 't.problem_side',
        telco_sr_number: 't.telco_sr_number',
        rating: 't.rating',
        rating_feedback_snippet: 'left(t.rating_feedback, 300)',
        created_at: 't.created_at',
        updated_at: 't.updated_at',
        resolved_at: 't.resolved_at',
        closed_at: 't.closed_at',
        last_activity_at: 'GREATEST(t.updated_at, COALESCE(ev.last_event_at, t.updated_at))'
      }
    },
    ticket_events_v: {
      from: 'ticket_events te\nLEFT JOIN employees emp ON emp.user_id = te.actor_user_id',
      columns: {
        id: 'te.id',
        ticket_id: 'te.ticket_id',
        actor_user_id: 'te.actor_user_id',
        actor_employee_pk: 'emp.id',
        event_type: 'te.event_type',
        message_snippet: 'left(te.message, 500)',
        new_status: "te.metadata->>'newStatus'",
        visible_to_customer: 'te.visible_to_customer',
        created_at: 'te.created_at'
      }
    },
    email_logs_v: {
      from: 'automated_email_logs',
      columns: { id: 'id', ticket_id: 'ticket_id', email_type: 'email_type', sent_at: 'sent_at' }
    }
  },
  indexes: {
    tables: [
      { table: 'tickets', columns: ['updated_at', 'id'], name: 'ai_tickets_updated_id' },
      { table: 'ticket_events', columns: ['created_at', 'id'], name: 'ai_ticket_events_created_id' },
      { table: 'ticket_events', columns: ['ticket_id', 'created_at'], name: 'ai_ticket_events_ticket_created' },
      { table: 'automated_email_logs', columns: ['sent_at', 'id'], name: 'ai_email_logs_sent_id' }
    ]
  }
});
