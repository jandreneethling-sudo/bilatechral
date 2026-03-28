const { format, subMonths } = require('date-fns');
const pool = require('../db/pool');
const { sendMonthlySummaryEmail } = require('./emailService');

const INTERVAL_MS = 1000 * 60 * 60 * 6;

async function getSummaryForMonth(month) {
  const result = await pool.query(
    `
      SELECT
        COALESCE(SUM(CASE WHEN transaction_type = 'supplier_offload' THEN net_weight ELSE 0 END), 0)::numeric(14,3) AS supplier_tonnage,
        COALESCE(SUM(CASE WHEN transaction_type = 'customer_load' THEN net_weight ELSE 0 END), 0)::numeric(14,3) AS customer_tonnage,
        COALESCE(SUM(CASE WHEN transaction_type = 'supplier_offload' THEN total_amount ELSE 0 END), 0)::numeric(14,2) AS supplier_value,
        COALESCE(SUM(CASE WHEN transaction_type = 'customer_load' THEN total_amount ELSE 0 END), 0)::numeric(14,2) AS sales_value,
        COUNT(*)::int AS total_tickets
      FROM weighbridge_tickets
      WHERE TO_CHAR(created_at, 'YYYY-MM') = $1
    `,
    [month]
  );

  return result.rows[0];
}

async function sendMonthlySummaryIfDue() {
  const now = new Date();
  if (now.getDate() !== 1) {
    return;
  }

  const previousMonth = format(subMonths(now, 1), 'yyyy-MM');
  const claimResult = await pool.query(
    `
      INSERT INTO monthly_summary_email_logs (month_key)
      VALUES ($1)
      ON CONFLICT (month_key) DO NOTHING
      RETURNING id
    `,
    [previousMonth]
  );

  if (!claimResult.rowCount) {
    return;
  }

  try {
    const summary = await getSummaryForMonth(previousMonth);
    const margin = Number(summary.sales_value) - Number(summary.supplier_value);

    await sendMonthlySummaryEmail({
      monthLabel: format(new Date(`${previousMonth}-01T00:00:00`), 'MMMM yyyy'),
      totalTickets: summary.total_tickets,
      supplierTonnage: Number(summary.supplier_tonnage).toFixed(3),
      customerTonnage: Number(summary.customer_tonnage).toFixed(3),
      supplierValue: Number(summary.supplier_value).toFixed(2),
      salesValue: Number(summary.sales_value).toFixed(2),
      margin: margin.toFixed(2)
    });
  } catch (error) {
    await pool.query('DELETE FROM monthly_summary_email_logs WHERE month_key = $1', [previousMonth]);
    throw error;
  }
}

function startMonthlySummaryScheduler() {
  sendMonthlySummaryIfDue().catch((error) => {
    console.error('Monthly summary check failed:', error.message);
  });

  const timer = setInterval(() => {
    sendMonthlySummaryIfDue().catch((error) => {
      console.error('Monthly summary check failed:', error.message);
    });
  }, INTERVAL_MS);

  return timer;
}

module.exports = {
  startMonthlySummaryScheduler,
  sendMonthlySummaryIfDue
};
