const nodemailer = require('nodemailer');

const PLACEHOLDER_VALUES = new Set([
  'smtp.example.com',
  'your-smtp-user',
  'your-smtp-password',
  'freddy@example.com'
]);

function isConfiguredValue(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  return !PLACEHOLDER_VALUES.has(trimmed.toLowerCase());
}

function hasSmtpConfiguration() {
  return (
    isConfiguredValue(process.env.SMTP_HOST) &&
    isConfiguredValue(process.env.SMTP_PORT) &&
    isConfiguredValue(process.env.SMTP_USER) &&
    isConfiguredValue(process.env.SMTP_PASS)
  );
}

function hasNotificationEmail() {
  return isConfiguredValue(process.env.MD_NOTIFICATION_EMAIL);
}

const hasSmtpConfig = hasSmtpConfiguration();

const transporter = hasSmtpConfig
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    })
  : null;

async function sendWeighbridgeAlert(ticket) {
  if (!transporter || !hasNotificationEmail()) {
    return false;
  }

  const subjectPrefix =
    ticket.transaction_type === 'supplier_offload' ? 'Supplier Offload' : 'Customer Load';

  const html = `
    <h3>Bilatechral Weighbridge Alert</h3>
    <p>A new ${subjectPrefix} transaction was captured.</p>
    <ul>
      <li>Ticket: <strong>${ticket.ticket_number}</strong></li>
      <li>Party: <strong>${ticket.party_name}</strong></li>
      <li>Truck: <strong>${ticket.truck_registration}</strong></li>
      <li>Net Weight: <strong>${ticket.net_weight} tons</strong></li>
      <li>Total Amount: <strong>R ${Number(ticket.total_amount || 0).toFixed(2)}</strong></li>
      <li>Captured By: <strong>${ticket.captured_by_name}</strong></li>
    </ul>
  `;

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: process.env.MD_NOTIFICATION_EMAIL,
    subject: `[Bilatechral] ${subjectPrefix} ${ticket.ticket_number}`,
    html
  });

  return true;
}

async function sendMonthlySummaryEmail(summary) {
  if (!transporter || !hasNotificationEmail()) {
    return false;
  }

  const html = `
    <h3>Bilatechral Monthly Summary</h3>
    <p>Reporting period: <strong>${summary.monthLabel}</strong></p>
    <ul>
      <li>Total tickets: <strong>${summary.totalTickets}</strong></li>
      <li>Supplier tonnage: <strong>${summary.supplierTonnage} t</strong></li>
      <li>Customer tonnage: <strong>${summary.customerTonnage} t</strong></li>
      <li>Supplier value: <strong>R ${summary.supplierValue}</strong></li>
      <li>Sales value: <strong>R ${summary.salesValue}</strong></li>
      <li>Estimated margin: <strong>R ${summary.margin}</strong></li>
    </ul>
  `;

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: process.env.MD_NOTIFICATION_EMAIL,
    subject: `[Bilatechral] Monthly Summary ${summary.monthLabel}`,
    html
  });

  return true;
}

async function getSmtpDiagnostics() {
  const configured = hasSmtpConfiguration();
  const notificationEmailConfigured = hasNotificationEmail();

  if (!configured) {
    return {
      configured: false,
      notificationEmailConfigured,
      canSend: false,
      host: process.env.SMTP_HOST || '',
      port: process.env.SMTP_PORT || '',
      from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
      notificationEmail: process.env.MD_NOTIFICATION_EMAIL || '',
      message: 'SMTP credentials are missing or still using placeholders.'
    };
  }

  try {
    await transporter.verify();
    return {
      configured: true,
      notificationEmailConfigured,
      canSend: notificationEmailConfigured,
      host: process.env.SMTP_HOST || '',
      port: process.env.SMTP_PORT || '',
      from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
      notificationEmail: process.env.MD_NOTIFICATION_EMAIL || '',
      message: notificationEmailConfigured
        ? 'SMTP connection verified successfully.'
        : 'SMTP works, but MD_NOTIFICATION_EMAIL is missing or placeholder.'
    };
  } catch (error) {
    return {
      configured: true,
      notificationEmailConfigured,
      canSend: false,
      host: process.env.SMTP_HOST || '',
      port: process.env.SMTP_PORT || '',
      from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
      notificationEmail: process.env.MD_NOTIFICATION_EMAIL || '',
      message: `SMTP verification failed: ${error.message}`
    };
  }
}

module.exports = {
  sendWeighbridgeAlert,
  sendMonthlySummaryEmail,
  getSmtpDiagnostics
};
