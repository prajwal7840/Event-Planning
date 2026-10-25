const { queries, expenses } = require('../repositories');
const AppError = require('../utils/appError');

function normalize(data) {
  const description = String(data.description || '').trim();
  const amount = Number(data.amount);
  if (!description || description.length > 255) throw new AppError(400, 'description is required and must be 255 characters or fewer');
  if (!Number.isFinite(amount) || amount < 0) throw new AppError(400, 'amount must be a non-negative number');
  const expenseDate = data.expense_date || null;
  if (expenseDate && Number.isNaN(Date.parse(expenseDate))) throw new AppError(400, 'expense_date must be a valid date');
  return { description, amount, expense_date: expenseDate };
}

async function list(userId, eventId) {
  if (!await queries.hostOwnsEvent(eventId, userId)) throw new AppError(404, 'Event not found');
  return queries.listExpensesForEvent(eventId, userId);
}

async function create(userId, eventId, data) {
  if (!await queries.hostOwnsEvent(eventId, userId)) throw new AppError(404, 'Event not found');
  const values = normalize(data);
  const bookingId = data.booking_id == null || data.booking_id === '' ? null : Number(data.booking_id);
  if (bookingId != null && (!Number.isSafeInteger(bookingId) || bookingId <= 0 || !await queries.isBookingForEvent(bookingId, eventId)))
    throw new AppError(400, 'booking_id must refer to a booking for this event');
  return expenses.create({ event_id: Number(eventId), booking_id: bookingId, ...values });
}

async function update(userId, id, data) {
  if (!await queries.findExpenseForHost(id, userId)) throw new AppError(404, 'Expense not found');
  const current = await expenses.findById(id);
  const values = normalize({ ...current, ...data });
  const updated = await expenses.updateWhere(id, values, { event_id: current.event_id });
  return updated;
}

async function remove(userId, id) {
  if (!await queries.findExpenseForHost(id, userId)) throw new AppError(404, 'Expense not found');
  await expenses.delete(id);
  return { message: 'Expense removed' };
}

module.exports = { list, create, update, remove };
