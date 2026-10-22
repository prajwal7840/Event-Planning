const { queries } = require('../repositories');
const AppError = require('../utils/appError');
async function forEvent(userId, eventId) {
  const summary = await queries.findBudgetForEvent(userId, eventId);
  if (!summary) throw new AppError(404, 'Budget summary not found for this event');
  return summary;
}
module.exports = { forEvent };
