const { queries } = require('../repositories');
const Invitation = require('../domain/entities').Invitation;
const AppError = require('../utils/appError');
const emailService = require('./email.service');

async function createForEvent(userId, eventId, invitees) {
  if (!Array.isArray(invitees) || !invitees.length) throw new AppError(400, 'invitees must be a non-empty array of {name, email}');
  if (!await queries.hostOwnsEvent(eventId, userId)) throw new AppError(404, 'Event not found');
  const normalizedInvitees = invitees.map(invitee => {
    const email = String(invitee.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) throw new AppError(400, 'Every invitee must have a valid email');
    return { ...invitee, email };
  });
  const created = await queries.createInvitations(eventId, normalizedInvitees);
  const event = await queries.findInvitationEventDetails(eventId);
  return Promise.all(created.map(async invite => {
    let status = invite.delivery_status;
    let deliveryError = null;
    try {
      const result = await emailService.sendInvitation(invite.email, event);
      if (result.sent) status = 'EMAIL_SENT';
    } catch (error) {
      deliveryError = String(error.message || 'Email delivery failed').slice(0, 255);
      if (status !== 'IN_APP') status = 'FAILED';
    }
    await queries.updateInvitationDelivery(invite.invitation_id, status, deliveryError);
    return { ...invite, delivery_status: status, delivery_error: deliveryError };
  }));
}

async function listMine(user) {
  return queries.listInvitationsFor(user);
}

async function listForEvent(userId, eventId) {
  if (!await queries.hostOwnsEvent(eventId, userId)) throw new AppError(404, 'Event not found');
  return queries.listInvitationsForEvent(eventId, userId);
}

async function rsvp(user, id, status) {
  const validation = Invitation.validateRsvp(status);
  if (validation) throw new AppError(400, validation);
  if (!await queries.updateRsvp(id, user, status)) throw new AppError(404, 'Invitation not found for this user');
  const invite = await queries.findInvitationHost(id);
  if (invite) await queries.createNotification(invite.host_id, `${user.name} responded ${status.toLowerCase()} to the invitation for ${invite.event_name}.`, 'INVITATION_RSVP');
}

module.exports = { createForEvent, listForEvent, listMine, rsvp };
