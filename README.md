# Bilatechral Web + Weighbridge MVP

Node.js + Express + PostgreSQL project for:
- Public company website
- Staff/MD login
- Weighbridge supplier and customer transactions
- Printable receipts and invoices
- Email notification to MD on each completed weigh event
- CSV and PDF exports
- Monthly MD tonnage and value report

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and update values.
3. Create PostgreSQL database:
   ```sql
   CREATE DATABASE bilatechral;
   ```
4. Run migrations and seed:
   ```bash
   npm run db:migrate
   npm run db:seed
   ```
5. Start app:
   ```bash
   npm run dev
   ```

Default seeded users:
- MD: `freddy.admin@bilatechral.co.za` / `Admin@123`
- Staff: `staff@bilatechral.co.za` / `Staff@123`

## Deployment Notes (cPanel)

- Use Node.js App feature in cPanel.
- Set app startup file to `src/server.js`.
- Configure environment variables in cPanel.
- Ensure PostgreSQL credentials and SMTP credentials are set.
- Run migration scripts once after deploy.

## Exports and Reports

- Ticket CSV export (MD): `/exports/tickets.csv?month=YYYY-MM`
- Monthly report page (MD): `/reports/monthly?month=YYYY-MM`
- Monthly report CSV (MD): `/reports/monthly.csv?month=YYYY-MM`
- Monthly report PDF (MD): `/reports/monthly.pdf?month=YYYY-MM`
- Receipt PDF: `/tickets/:id/receipt.pdf`
- Invoice PDF (MD): `/invoices/:ticketId/pdf`
- Invoice lifecycle actions (MD): mark invoice as `sent` and `paid` from the invoice page.
- Monthly report includes a **Send Test Email** button (MD only) to verify SMTP delivery on demand.

### Monthly summary email (automatic)

- On the 1st day of each month, the system emails Freddy a summary for the previous month.
- The send is deduplicated in the database via `monthly_summary_email_logs`.
- Ensure SMTP and `MD_NOTIFICATION_EMAIL` are configured in `.env` for this to work.
- MD SMTP diagnostics page: `/settings/smtp-diagnostics`

## Security

Rotate credentials if exposed and never commit `.env`.

Additional hardening in this codebase:
- Helmet security headers are enabled.
- Login POST is rate-limited to reduce brute-force attempts.
- Session cookies use `secure` in production and stricter `sameSite` policy.
- CSRF protection is enforced for all state-changing requests (`POST`, etc.).
- Basic server-side validation is applied to login and ticket capture inputs.
