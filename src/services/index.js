// Composition root for application services and repositories.
module.exports = {
  ...require('../repositories'),
  auth: require('./auth.service'),
  authorization: require('./authorization.service'),
  eventService: require('./event.service'),
  bookingService: require('./booking.service'),
  marketplaceService: require('./marketplace.service'),
  invitationService: require('./invitation.service'),
  notificationService: require('./notification.service'),
  budgetService: require('./budget.service')
};
