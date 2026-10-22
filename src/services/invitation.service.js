const { queries } = require('../repositories');
const Invitation = require('../domain/entities').Invitation;
const AppError = require('../utils/appError');

async function createForEvent(userId, eventId, invitees) {
  if (!Array.isArray(invitees) || !invitees.length) throw new AppError(400, 'invitees must be a non-empty array of {name, email}');
  if (!await queries.hostOwnsEvent(eventId, userId)) throw new AppError(404, 'Event not found');
  const normalizedInvitees = invitees.map(invitee => {
    const email = String(invitee.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) throw new AppError(400, 'Every invitee must have a valid email');
    return { ...invitee, email };
  });
  return queries.createInvitations(eventId, normalizedInvitees);
}

async function listMine(user) {
  return queries.listInvitationsFor(user);
}

async function rsvp(user, id, status) {
  const validation = Invitation.validateRsvp(status);
  if (validation) throw new AppError(400, validation);
  if (!await queries.updateRsvp(id, user, status)) throw new AppError(404, 'Invitation not found for this user');
}

module.exports = { createForEvent, listMine, rsvp };
