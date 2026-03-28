function pad(value) {
  return String(value).padStart(5, '0');
}

function ticketNumber(id) {
  return `BT-${new Date().getFullYear()}-${pad(id)}`;
}

function invoiceNumber(id) {
  return `INV-${new Date().getFullYear()}-${pad(id)}`;
}

module.exports = {
  ticketNumber,
  invoiceNumber
};
