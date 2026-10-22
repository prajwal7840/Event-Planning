const AppError = require('../utils/appError');

const ROLES = Object.freeze({ HOST: 'HOST', VENDOR: 'VENDOR', INVITEE: 'INVITEE' });
const validRoles = Object.values(ROLES);

function requireRoles(user, ...allowedRoles) {
  if (!user) throw new AppError(401, 'Authentication required');
  if (!allowedRoles.includes(user.role)) {
    throw new AppError(403, 'You do not have permission for this action');
  }
  return user;
}

module.exports = { ROLES, validRoles, requireRoles };
