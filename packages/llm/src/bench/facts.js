export const formatInr = (value) => {
  const negative = value < 0;
  const [whole, fraction] = Math.abs(value).toFixed(Number.isInteger(value) ? 0 : 2).split('.');
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${negative ? '-' : ''}₹${grouped}${fraction ? `.${fraction}` : ''}`;
};

const money = (label, value) => ({ label, value, display: formatInr(value) });
const percent = (label, value) => ({ label, value, display: `${value}%` });
const count = (label, value) => ({ label, value, display: String(value) });

export const SAMPLE_FACT_SETS = Object.freeze([
  {
    id: 'sales-1',
    profile: 'sales',
    period: '2026-08',
    metrics: [
      count('Mbps sold', 1840),
      money('Monthly recurring revenue added', 1234500),
      percent('Target attainment', 82.5),
      count('New connections', 37)
    ],
    flags: ['NO_TARGET']
  },
  {
    id: 'sales-2',
    profile: 'sales',
    period: '2026-07',
    metrics: [count('Mbps sold', 960), money('Monthly recurring revenue added', 654300), percent('Target attainment', 104.2), count('Terminations', 4)],
    flags: []
  },
  {
    id: 'collections-1',
    profile: 'collections',
    period: '2026-08',
    metrics: [
      money('Outstanding', 4521000),
      money('Collected this month', 1875000),
      percent('Collection efficiency', 41.5),
      count('Invoices overdue over 60 days', 12)
    ],
    flags: ['SOURCE_STALE']
  },
  {
    id: 'collections-2',
    profile: 'collections',
    period: '2026-W33',
    metrics: [money('Outstanding', 980000), money('Collected this week', 310000), percent('Collection efficiency', 31.6), count('Promises to pay', 9)],
    flags: []
  },
  {
    id: 'support-1',
    profile: 'support',
    period: '2026-08',
    metrics: [count('Tickets resolved', 142), count('Tickets open', 23), percent('Resolved within target', 88.7), count('Median hours to resolve', 19)],
    flags: ['UNMAPPED_CUSTOMER']
  },
  {
    id: 'support-2',
    profile: 'support',
    period: '2026-W33',
    metrics: [count('Tickets resolved', 31), count('Tickets open', 8), percent('Resolved within target', 93.5), count('Reopened tickets', 2)],
    flags: []
  }
]);

export const EMBED_PAIRS = Object.freeze([
  {
    query: 'customer reports packet loss on the backhaul link',
    documents: [
      'Category: Link down | Problem side: telco | Issue: intermittent packet loss on backhaul | RCA: faulty transceiver replaced',
      'Category: Billing | Issue: invoice shows wrong GST rate | RCA: tax profile corrected',
      'Category: Provisioning | Issue: new circuit activation delayed | RCA: pending last mile approval'
    ],
    answer: 0
  },
  {
    query: 'invoice tax percentage is incorrect',
    documents: [
      'Category: Link down | Issue: complete outage at customer site | RCA: fibre cut repaired',
      'Category: Billing | Issue: GST percentage wrong on invoice | RCA: tax profile corrected',
      'Category: Provisioning | Issue: bandwidth upgrade not reflected | RCA: configuration pushed'
    ],
    answer: 1
  },
  {
    query: 'upgrade request not yet applied on the circuit',
    documents: [
      'Category: Billing | Issue: credit note not received | RCA: credit note issued',
      'Category: Link down | Issue: flapping interface | RCA: cable replaced',
      'Category: Provisioning | Issue: bandwidth upgrade not reflected | RCA: configuration pushed'
    ],
    answer: 2
  }
]);
