const { events, queries } = require('../repositories');
const Event = require('../domain/entities').Event;
const AppError = require('../utils/appError');
const { ROLES, requireRoles } = require('./authorization.service');

async function list(user) {
  requireRoles(user, ROLES.HOST, ROLES.INVITEE);
  return queries.listEventsFor(user);
}

async function create(userId, data) {
  const validation = Event.validate(data);
  if (validation) throw new AppError(400, validation);
  return events.create({ host_id: userId, name: String(data.name).trim(), event_type: data.event_type,
    event_date: data.event_date, start_time: data.start_time, duration_hours: Number(data.duration_hours),
    attendee_count: Number(data.attendee_count), budget: Number(data.budget) });
}

async function getForUser(id, user) {
  requireRoles(user, ROLES.HOST, ROLES.INVITEE);
  const event = await queries.findEventById(id);
  if (!event) throw new AppError(404, 'Event not found');
  if (user.role === ROLES.HOST && Number(event.host_id) !== Number(user.user_id)) throw new AppError(403, 'You cannot view this event');
  if (user.role === ROLES.INVITEE) {
    if (!await queries.isInviteeForEvent(event.event_id, user)) throw new AppError(403, 'You are not invited to this event');
    delete event.budget;
    delete event.host_id;
    Object.assign(event, await queries.findHostContactForEvent(event.event_id) || {});
  }
  return event;
}

async function getBookingsForUser(eventId, user) {
  await getForUser(eventId, user);
  return user.role === ROLES.INVITEE
    ? queries.listEventBookingsForInvitee(eventId)
    : queries.listEventBookingsForHost(eventId, user.user_id);
}

async function update(id, userId, data) {
  const previous = await queries.findEventById(id);
  const allowed = ['name', 'event_type', 'event_date', 'start_time', 'duration_hours', 'attendee_count', 'budget', 'status'];
  const updates = allowed.filter(key => Object.prototype.hasOwnProperty.call(data, key));
  if (!updates.length) throw new AppError(400, 'No supported fields supplied');
  const updated = await events.updateWhere(id, Object.fromEntries(updates.map(key => [key, data[key]])), { host_id: userId });
  if (!updated) throw new AppError(404, 'Event not found');
  const dateChanged = updates.includes('event_date') && String(previous?.event_date).slice(0, 10) !== String(data.event_date).slice(0, 10);
  const timeChanged = updates.includes('start_time') && String(previous?.start_time).slice(0, 8) !== String(data.start_time).slice(0, 8);
  if (dateChanged || timeChanged) await queries.notifyEventInvitees(id, 'The event date or time has changed. Open your invitation to see the updated details.');
  return { message: 'Event updated' };
}

async function remove(id, userId) {
  if (!await events.deleteWhere(id, { host_id: userId })) throw new AppError(404, 'Event not found');
  return { message: 'Event deleted' };
}

module.exports = { list, create, getForUser, getBookingsForUser, update, remove };
