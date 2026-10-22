const { queries } = require('../repositories');
const AppError = require('../utils/appError');

async function listForUser(userId) {
  return queries.listNotifications(userId);
}
async function markRead(userId, id) {
  if (!await queries.markNotificationRead(userId, id)) throw new AppError(404, 'Notification not found');
}
module.exports = { listForUser, markRead };
