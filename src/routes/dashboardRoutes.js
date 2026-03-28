const express = require('express');
const { format } = require('date-fns');
const PDFDocument = require('pdfkit');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { ticketNumber, invoiceNumber } = require('../services/numberingService');
const {
  sendWeighbridgeAlert,
  sendMonthlySummaryEmail,
  getSmtpDiagnostics
} = require('../services/emailService');

const router = express.Router();
const ALLOWED_TRANSACTION_TYPES = new Set(['supplier_offload', 'customer_load']);

function normalizeText(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return '';
  }

  return normalized.slice(0, maxLength);
}

function parseNonNegativeNumber(value, decimals) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Number(parsed.toFixed(decimals));
}

function calculateNetWeight(tareWeight, grossWeight) {
  const net = Number(grossWeight) - Number(tareWeight);
  return net > 0 ? Number(net.toFixed(3)) : 0;
}

function calculateTotalAmount(netWeight, unitPrice) {
  if (!unitPrice || Number(unitPrice) <= 0) {
    return 0;
  }
  return Number((Number(netWeight) * Number(unitPrice)).toFixed(2));
}

function formatMonthLabel(monthValue) {
  const date = new Date(`${monthValue}-01T00:00:00`);
  return format(date, 'MMMM yyyy');
}

function resolveMonth(value) {
  const validMonth = /^\d{4}-\d{2}$/.test(value || '');
  if (validMonth) {
    return value;
  }
  return format(new Date(), 'yyyy-MM');
}

function buildCsv(rows) {
  const escapeValue = (value) => {
    const stringValue = value === null || value === undefined ? '' : String(value);
    const safeValue = stringValue.replace(/"/g, '""');
    return `"${safeValue}"`;
  };

  return rows.map((row) => row.map((value) => escapeValue(value)).join(',')).join('\n');
}

function writeTicketPdf(res, title, ticket) {
  const doc = new PDFDocument({ margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${ticket.ticket_number}.pdf"`);
  doc.pipe(res);

  doc.fontSize(18).text('Bilatechral Solutions (PTY) Ltd');
  doc.fontSize(10).text('Reg Nr: 2023/910602/07');
  doc.text('Portion 5, Olifanstpoortje 319 KT, Extention 23, Steelpoort, Limpopo, South Africa');
  doc.moveDown();
  doc.fontSize(14).text(title);
  doc.moveDown(0.5);

  doc.fontSize(10);
  doc.text(`Ticket: ${ticket.ticket_number}`);
  doc.text(`Date: ${format(new Date(ticket.created_at), 'dd MMM yyyy HH:mm')}`);
  doc.text(`Type: ${ticket.transaction_type}`);
  doc.text(`Party: ${ticket.party_name}`);
  doc.text(`Truck: ${ticket.truck_registration}`);
  doc.text(`Driver: ${ticket.driver_name || 'N/A'}`);
  doc.text(`Ore Grade: ${ticket.ore_grade || 'N/A'}`);
  doc.text(`Captured By: ${ticket.captured_by_name}`);
  doc.moveDown();
  doc.text(`Tare: ${ticket.tare_weight} t`);
  doc.text(`Gross: ${ticket.gross_weight} t`);
  doc.text(`Net: ${ticket.net_weight} t`);
  doc.text(`Unit Price: R ${Number(ticket.unit_price || 0).toFixed(2)} per ton`);
  doc.text(`Total Amount: R ${Number(ticket.total_amount || 0).toFixed(2)}`);
  doc.moveDown();
  doc.text(`Notes: ${ticket.notes || 'None'}`);

  doc.end();
}

function writeInvoicePdf(res, invoice) {
  const doc = new PDFDocument({ margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoice_number}.pdf"`);
  doc.pipe(res);

  doc.fontSize(18).text('Bilatechral Solutions (PTY) Ltd');
  doc.fontSize(10).text('Reg Nr: 2023/910602/07');
  doc.text('Portion 5, Olifanstpoortje 319 KT, Extention 23, Steelpoort, Limpopo, South Africa');
  doc.moveDown();
  doc.fontSize(14).text('Customer Invoice');
  doc.moveDown(0.5);

  doc.fontSize(10);
  doc.text(`Invoice: ${invoice.invoice_number}`);
  doc.text(`Date: ${format(new Date(invoice.generated_at), 'dd MMM yyyy HH:mm')}`);
  doc.text(`Status: ${invoice.status}`);
  doc.text(`Customer: ${invoice.customer_name}`);
  doc.text(`Ticket: ${invoice.ticket_number}`);
  doc.text(`Truck Registration: ${invoice.truck_registration}`);
  doc.text(`Ore Grade: ${invoice.ore_grade || 'N/A'}`);
  doc.text(`Net Tonnage: ${invoice.net_weight} t`);
  doc.text(`Captured By: ${invoice.captured_by_name}`);
  doc.moveDown();
  doc.text(`Amount Due: R ${Number(invoice.amount).toFixed(2)}`);

  doc.end();
}

async function getMonthlySummary(month) {
  const summaryResult = await pool.query(
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

  return summaryResult.rows[0];
}

router.get('/dashboard', requireAuth, async (req, res) => {
  const ticketsResult = await pool.query(
    `
      SELECT t.*, i.status AS invoice_status
      FROM weighbridge_tickets t
      LEFT JOIN invoices i ON i.ticket_id = t.id
      ORDER BY t.created_at DESC
      LIMIT 10
    `
  );

  const statsResult = await pool.query(
    `
      SELECT
        COUNT(*)::int AS total_tickets,
        COALESCE(SUM(CASE WHEN transaction_type = 'supplier_offload' THEN net_weight ELSE 0 END), 0)::numeric(14,3) AS supplier_tonnage,
        COALESCE(SUM(CASE WHEN transaction_type = 'customer_load' THEN net_weight ELSE 0 END), 0)::numeric(14,3) AS customer_tonnage
      FROM weighbridge_tickets
    `
  );

  return res.render('dashboard/index', {
    title: 'Dashboard',
    user: req.session.user,
    tickets: ticketsResult.rows,
    stats: statsResult.rows[0],
    formatDate: (value) => format(new Date(value), 'dd MMM yyyy HH:mm')
  });
});

router.get('/tickets/new', requireRole('staff', 'md'), (req, res) => {
  res.render('tickets/new', {
    title: 'New Weighbridge Ticket',
    user: req.session.user,
    error: null
  });
});

router.post('/tickets', requireRole('staff', 'md'), async (req, res) => {
  const {
    transactionType,
    partyName,
    truckRegistration,
    driverName,
    oreGrade,
    tareWeight,
    grossWeight,
    unitPrice,
    notes
  } = req.body;

  const safeTransactionType = normalizeText(transactionType, 20);
  const safePartyName = normalizeText(partyName, 150);
  const safeTruckRegistration = normalizeText(truckRegistration, 30).toUpperCase();
  const safeDriverName = normalizeText(driverName, 100);
  const safeOreGrade = normalizeText(oreGrade, 50);
  const safeNotes = normalizeText(notes, 1000);

  const safeTareWeight = parseNonNegativeNumber(tareWeight, 3);
  const safeGrossWeight = parseNonNegativeNumber(grossWeight, 3);
  const safeUnitPrice = unitPrice === '' || unitPrice === null || unitPrice === undefined
    ? null
    : parseNonNegativeNumber(unitPrice, 2);

  if (
    !ALLOWED_TRANSACTION_TYPES.has(safeTransactionType) ||
    !safePartyName ||
    !safeTruckRegistration ||
    safeTareWeight === null ||
    safeGrossWeight === null ||
    (unitPrice !== '' && unitPrice !== null && unitPrice !== undefined && safeUnitPrice === null)
  ) {
    return res.status(400).render('tickets/new', {
      title: 'New Weighbridge Ticket',
      user: req.session.user,
      error: 'Please provide valid ticket details in all required fields.'
    });
  }

  const netWeight = calculateNetWeight(safeTareWeight, safeGrossWeight);
  const totalAmount = calculateTotalAmount(netWeight, safeUnitPrice);

  if (netWeight <= 0) {
    return res.status(400).render('tickets/new', {
      title: 'New Weighbridge Ticket',
      user: req.session.user,
      error: 'Gross weight must be larger than tare weight.'
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const insertResult = await client.query(
      `
        INSERT INTO weighbridge_tickets (
          ticket_number,
          transaction_type,
          party_name,
          truck_registration,
          driver_name,
          ore_grade,
          tare_weight,
          gross_weight,
          net_weight,
          unit_price,
          total_amount,
          notes,
          captured_by_user_id,
          captured_by_name
        ) VALUES (
          '',
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13
        )
        RETURNING *
      `,
      [
        safeTransactionType,
        safePartyName,
        safeTruckRegistration,
        safeDriverName || null,
        safeOreGrade || null,
        safeTareWeight,
        safeGrossWeight,
        netWeight,
        safeUnitPrice,
        totalAmount,
        safeNotes || null,
        req.session.user.id,
        req.session.user.fullName
      ]
    );

    const ticket = insertResult.rows[0];
    const generatedTicketNumber = ticketNumber(ticket.id);

    await client.query('UPDATE weighbridge_tickets SET ticket_number = $1 WHERE id = $2', [
      generatedTicketNumber,
      ticket.id
    ]);

    if (safeTransactionType === 'customer_load') {
      const invoiceInsertResult = await client.query(
        `
          INSERT INTO invoices (
            invoice_number,
            ticket_id,
            customer_name,
            amount,
            status,
            generated_by_user_id
          ) VALUES ('', $1, $2, $3, 'draft', $4)
          RETURNING id
        `,
        [ticket.id, safePartyName, totalAmount, req.session.user.id]
      );

      const generatedInvoiceNumber = invoiceNumber(invoiceInsertResult.rows[0].id);
      await client.query('UPDATE invoices SET invoice_number = $1 WHERE id = $2', [
        generatedInvoiceNumber,
        invoiceInsertResult.rows[0].id
      ]);
    }

    if (safeTransactionType === 'supplier_offload') {
      await client.query(
        `
          INSERT INTO payments (ticket_id, supplier_name, amount, status)
          VALUES ($1, $2, $3, 'pending')
        `,
        [ticket.id, safePartyName, totalAmount]
      );
    }

    await client.query('COMMIT');

    const finalTicket = {
      ...ticket,
      ticket_number: generatedTicketNumber,
      total_amount: totalAmount
    };

    sendWeighbridgeAlert(finalTicket).catch(() => {});

    return res.redirect(`/tickets/${ticket.id}/receipt`);
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).render('tickets/new', {
      title: 'New Weighbridge Ticket',
      user: req.session.user,
      error: 'Could not save ticket. Please try again.'
    });
  } finally {
    client.release();
  }
});

router.get('/tickets/:id/receipt', requireRole('staff', 'md'), async (req, res) => {
  const result = await pool.query('SELECT * FROM weighbridge_tickets WHERE id = $1', [req.params.id]);

  if (!result.rowCount) {
    return res.status(404).send('Ticket not found');
  }

  return res.render('tickets/receipt', {
    title: 'Weighbridge Receipt',
    user: req.session.user,
    ticket: result.rows[0],
    formatDate: (value) => format(new Date(value), 'dd MMM yyyy HH:mm')
  });
});

router.get('/tickets/:id/receipt.pdf', requireRole('staff', 'md'), async (req, res) => {
  const result = await pool.query('SELECT * FROM weighbridge_tickets WHERE id = $1', [req.params.id]);

  if (!result.rowCount) {
    return res.status(404).send('Ticket not found');
  }

  writeTicketPdf(res, 'Weighbridge Receipt', result.rows[0]);
  return null;
});

router.get('/invoices/:ticketId', requireRole('md'), async (req, res) => {
  const result = await pool.query(
    `
      SELECT i.*, t.ticket_number, t.id AS ticket_id, t.truck_registration, t.net_weight, t.ore_grade, t.captured_by_name
      FROM invoices i
      JOIN weighbridge_tickets t ON t.id = i.ticket_id
      WHERE i.ticket_id = $1
    `,
    [req.params.ticketId]
  );

  if (!result.rowCount) {
    return res.status(404).send('Invoice not found');
  }

  return res.render('tickets/invoice', {
    title: 'Customer Invoice',
    user: req.session.user,
    invoice: result.rows[0],
    formatDate: (value) => format(new Date(value), 'dd MMM yyyy HH:mm')
  });
});

router.get('/invoices/:ticketId/pdf', requireRole('md'), async (req, res) => {
  const result = await pool.query(
    `
      SELECT i.*, t.ticket_number, t.id AS ticket_id, t.truck_registration, t.net_weight, t.ore_grade, t.captured_by_name
      FROM invoices i
      JOIN weighbridge_tickets t ON t.id = i.ticket_id
      WHERE i.ticket_id = $1
    `,
    [req.params.ticketId]
  );

  if (!result.rowCount) {
    return res.status(404).send('Invoice not found');
  }

  writeInvoicePdf(res, result.rows[0]);
  return null;
});

router.post('/invoices/:ticketId/mark-sent', requireRole('md'), async (req, res) => {
  const updateResult = await pool.query(
    `
      UPDATE invoices
      SET status = 'sent'
      WHERE ticket_id = $1 AND status = 'draft'
      RETURNING ticket_id
    `,
    [req.params.ticketId]
  );

  if (!updateResult.rowCount) {
    const existing = await pool.query('SELECT ticket_id FROM invoices WHERE ticket_id = $1', [
      req.params.ticketId
    ]);

    if (!existing.rowCount) {
      return res.status(404).send('Invoice not found');
    }
  }

  return res.redirect(`/invoices/${req.params.ticketId}`);
});

router.post('/invoices/:ticketId/mark-paid', requireRole('md'), async (req, res) => {
  const updateResult = await pool.query(
    `
      UPDATE invoices
      SET status = 'paid'
      WHERE ticket_id = $1 AND status IN ('draft', 'sent')
      RETURNING ticket_id
    `,
    [req.params.ticketId]
  );

  if (!updateResult.rowCount) {
    const existing = await pool.query('SELECT ticket_id FROM invoices WHERE ticket_id = $1', [
      req.params.ticketId
    ]);

    if (!existing.rowCount) {
      return res.status(404).send('Invoice not found');
    }
  }

  return res.redirect(`/invoices/${req.params.ticketId}`);
});

router.get('/exports/tickets.csv', requireRole('md'), async (req, res) => {
  const month = resolveMonth(req.query.month);

  const result = await pool.query(
    `
      SELECT
        ticket_number,
        transaction_type,
        party_name,
        truck_registration,
        tare_weight,
        gross_weight,
        net_weight,
        unit_price,
        total_amount,
        captured_by_name,
        created_at
      FROM weighbridge_tickets
      WHERE TO_CHAR(created_at, 'YYYY-MM') = $1
      ORDER BY created_at DESC
    `,
    [month]
  );

  const rows = [
    [
      'Ticket Number',
      'Transaction Type',
      'Party',
      'Truck Registration',
      'Tare Weight',
      'Gross Weight',
      'Net Weight',
      'Unit Price',
      'Total Amount',
      'Captured By',
      'Created At'
    ],
    ...result.rows.map((row) => [
      row.ticket_number,
      row.transaction_type,
      row.party_name,
      row.truck_registration,
      row.tare_weight,
      row.gross_weight,
      row.net_weight,
      row.unit_price,
      row.total_amount,
      row.captured_by_name,
      format(new Date(row.created_at), 'yyyy-MM-dd HH:mm')
    ])
  ];

  const csv = buildCsv(rows);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="tickets-${month}.csv"`);
  return res.send(csv);
});

router.get('/reports/monthly', requireRole('md'), async (req, res) => {
  const month = resolveMonth(req.query.month);

  const summary = await getMonthlySummary(month);
  const transactionResult = await pool.query(
    `
      SELECT
        ticket_number,
        transaction_type,
        party_name,
        net_weight,
        total_amount,
        created_at
      FROM weighbridge_tickets
      WHERE TO_CHAR(created_at, 'YYYY-MM') = $1
      ORDER BY created_at DESC
    `,
    [month]
  );

  const margin = Number(summary.sales_value) - Number(summary.supplier_value);

  return res.render('dashboard/monthly-report', {
    title: 'Monthly Report',
    user: req.session.user,
    month,
    monthLabel: formatMonthLabel(month),
    emailStatus: req.query.emailStatus || null,
    summary: {
      ...summary,
      margin: Number(margin.toFixed(2))
    },
    transactions: transactionResult.rows,
    formatDate: (value) => format(new Date(value), 'dd MMM yyyy HH:mm')
  });
});

router.post('/reports/monthly/test-email', requireRole('md'), async (req, res) => {
  const month = resolveMonth(req.body.month || req.query.month);

  try {
    const summary = await getMonthlySummary(month);
    const margin = Number(summary.sales_value) - Number(summary.supplier_value);

    const sent = await sendMonthlySummaryEmail({
      monthLabel: formatMonthLabel(month),
      totalTickets: summary.total_tickets,
      supplierTonnage: Number(summary.supplier_tonnage).toFixed(3),
      customerTonnage: Number(summary.customer_tonnage).toFixed(3),
      supplierValue: Number(summary.supplier_value).toFixed(2),
      salesValue: Number(summary.sales_value).toFixed(2),
      margin: margin.toFixed(2)
    });

    if (!sent) {
      return res.redirect(`/reports/monthly?month=${month}&emailStatus=smtp-not-configured`);
    }

    return res.redirect(`/reports/monthly?month=${month}&emailStatus=sent`);
  } catch (error) {
    return res.redirect(`/reports/monthly?month=${month}&emailStatus=failed`);
  }
});

router.get('/settings/smtp-diagnostics', requireRole('md'), async (req, res) => {
  const diagnostics = await getSmtpDiagnostics();

  return res.render('dashboard/smtp-diagnostics', {
    title: 'SMTP Diagnostics',
    user: req.session.user,
    diagnostics
  });
});

router.get('/reports/monthly.csv', requireRole('md'), async (req, res) => {
  const month = resolveMonth(req.query.month);

  const summary = await getMonthlySummary(month);
  const transactionsResult = await pool.query(
    `
      SELECT
        ticket_number,
        transaction_type,
        party_name,
        net_weight,
        total_amount,
        created_at
      FROM weighbridge_tickets
      WHERE TO_CHAR(created_at, 'YYYY-MM') = $1
      ORDER BY created_at DESC
    `,
    [month]
  );

  const margin = (Number(summary.sales_value) - Number(summary.supplier_value)).toFixed(2);

  const rows = [
    ['Monthly Report', month],
    ['Supplier Tonnage', summary.supplier_tonnage],
    ['Customer Tonnage', summary.customer_tonnage],
    ['Supplier Value', summary.supplier_value],
    ['Sales Value', summary.sales_value],
    ['Estimated Margin', margin],
    ['Total Tickets', summary.total_tickets],
    [],
    ['Ticket Number', 'Type', 'Party', 'Net Weight', 'Total Amount', 'Created At'],
    ...transactionsResult.rows.map((row) => [
      row.ticket_number,
      row.transaction_type,
      row.party_name,
      row.net_weight,
      row.total_amount,
      format(new Date(row.created_at), 'yyyy-MM-dd HH:mm')
    ])
  ];

  const csv = buildCsv(rows);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="monthly-report-${month}.csv"`);
  return res.send(csv);
});

router.get('/reports/monthly.pdf', requireRole('md'), async (req, res) => {
  const month = resolveMonth(req.query.month);
  const summary = await getMonthlySummary(month);
  const margin = Number(summary.sales_value) - Number(summary.supplier_value);

  const doc = new PDFDocument({ margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="monthly-report-${month}.pdf"`);
  doc.pipe(res);

  doc.fontSize(18).text('Bilatechral Solutions (PTY) Ltd');
  doc.fontSize(10).text('Monthly Operations Report');
  doc.text(`Period: ${formatMonthLabel(month)}`);
  doc.moveDown();
  doc.text(`Total Tickets: ${summary.total_tickets}`);
  doc.text(`Supplier Tonnage: ${summary.supplier_tonnage} t`);
  doc.text(`Customer Tonnage: ${summary.customer_tonnage} t`);
  doc.text(`Supplier Value: R ${Number(summary.supplier_value).toFixed(2)}`);
  doc.text(`Sales Value: R ${Number(summary.sales_value).toFixed(2)}`);
  doc.text(`Estimated Margin: R ${margin.toFixed(2)}`);

  doc.end();
  return null;
});

router.get('/payments', requireRole('md'), async (req, res) => {
  const result = await pool.query(
    `
      SELECT p.*, t.ticket_number, t.net_weight
      FROM payments p
      JOIN weighbridge_tickets t ON t.id = p.ticket_id
      ORDER BY p.created_at DESC
    `
  );

  return res.render('dashboard/payments', {
    title: 'Supplier Payments',
    user: req.session.user,
    payments: result.rows,
    formatDate: (value) => format(new Date(value), 'dd MMM yyyy HH:mm')
  });
});

router.post('/payments/:id/mark-paid', requireRole('md'), async (req, res) => {
  await pool.query(
    `
      UPDATE payments
      SET status = 'paid', processed_by_user_id = $1, processed_at = NOW()
      WHERE id = $2
    `,
    [req.session.user.id, req.params.id]
  );

  return res.redirect('/payments');
});

module.exports = router;
