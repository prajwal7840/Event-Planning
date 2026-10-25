const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const repositories = require('../src/repositories');
const Entity = require('../src/domain/entities');
const AppError = require('../src/utils/appError');
const asyncHandler = require('../src/utils/asyncHandler');
const auth = require('../src/services/auth.service');
const authorization = require('../src/services/authorization.service');
const events = require('../src/services/event.service');
const bookings = require('../src/services/booking.service');
const marketplace = require('../src/services/marketplace.service');
const invitations = require('../src/services/invitation.service');
const budget = require('../src/services/budget.service');
const notifications = require('../src/services/notification.service');
const availability = require('../src/services/availability.service');
const expenses = require('../src/services/expense.service');
const { authenticate, allowRoles } = require('../src/middleware/auth');
const { notFound, errorHandler } = require('../src/middleware/errors');
const BaseRepository = require('../src/repositories/base.repository');
const ReadOnlyRepository = require('../src/repositories/read-only.repository');
const DatabaseRepository = require('../src/repositories/database.repository');

const targets = [repositories.users, repositories.events, repositories.venues, repositories.vendorOfferings,
  repositories.vendorProfiles, repositories.availabilitySlots, repositories.expenses, repositories.queries, repositories.db];
const originals = new Map();
function stub(target, key, value) {
  if (!originals.has(target)) originals.set(target, {});
  if (!(key in originals.get(target))) originals.get(target)[key] = target[key];
  target[key] = value;
}
afterEach(() => {
  for (const [target, methods] of originals) for (const [key, value] of Object.entries(methods)) target[key] = value;
  originals.clear();
  delete process.env.JWT_SECRET;
  delete process.env.NODE_ENV;
});

test('domain entities map rows, hide password hashes, and validate domain inputs', () => {
  const user = Entity.User.fromRow({ user_id: 2, email: 'a@b.test', password_hash: 'secret' });
  assert.deepEqual(user.toJSON(), { user_id: 2, email: 'a@b.test' });
  assert.equal(Entity.User.fromRow(null), null);
  assert.equal(Entity.Event.validate({ name:'X', event_type:'Party', event_date:'2026-01-01', start_time:'10:00', duration_hours:2, attendee_count:1, budget:0 }), null);
  assert.match(Entity.Event.validate({}), /required/);
  assert.match(Entity.Event.validate({ name:'X', event_type:'P', event_date:'x', start_time:'x', duration_hours:0, attendee_count:1, budget:0 }), /duration_hours/);
  assert.match(Entity.Event.validate({ name:'X', event_type:'P', event_date:'x', start_time:'x', duration_hours:1, attendee_count:1.2, budget:0 }), /attendee_count/);
  assert.match(Entity.Event.validate({ name:'X', event_type:'P', event_date:'x', start_time:'x', duration_hours:1, attendee_count:1, budget:-1 }), /budget/);
  assert.equal(Entity.Invitation.validateRsvp('ACCEPTED'), null);
  assert.match(Entity.Invitation.validateRsvp('MAYBE'), /ACCEPTED/);
  assert.equal(Entity.Venue.validate({ name:'Hall', address:'Road', capacity:20, base_price:0 }), null);
  assert.match(Entity.Venue.validate({ name:'Hall', address:'Road', capacity:0 }), /capacity/);
  assert.match(Entity.Venue.validate({ name:'Hall', address:'Road', capacity:20, base_price:-1 }), /base_price/);
  assert.equal(Entity.VendorOffering.validate({ category:'Food', name:'Meal', offering_type:'SERVICE', price:0 }), null);
  assert.match(Entity.VendorOffering.validate({ category:'Food', name:'Meal', offering_type:'BAD' }), /offering_type/);
  assert.equal(Entity.Booking.validate({ event_id:1, venue_id:2, start_datetime:'2026-01-01', end_datetime:'2026-01-02', agreed_price:0 }), null);
  assert.match(Entity.Booking.validate({ event_id:1, venue_id:2, offering_id:3, start_datetime:'2026-01-01', end_datetime:'2026-01-02' }), /exactly one/);
  assert.match(Entity.Booking.validate({ event_id:1, venue_id:2, start_datetime:'2026-01-02', end_datetime:'2026-01-01' }), /time range/);
  assert.match(Entity.Booking.validate({ event_id:1, offering_id:2, start_datetime:'2026-01-01', end_datetime:'2026-01-02', agreed_price:-1 }), /agreed_price/);
  for (const C of [Entity.VendorProfile, Entity.Notification, Entity.AvailabilitySlot, Entity.Expense, Entity.EventBudgetSummary, Entity.InviteeEvent]) {
    const row = { id: 1 }; assert.deepEqual(new C(row).toJSON(), row);
  }
});

test('authorization and application errors enforce role boundaries', () => {
  assert.deepEqual(authorization.validRoles, ['HOST', 'VENDOR', 'INVITEE']);
  assert.throws(() => authorization.requireRoles(null, 'HOST'), { status: 401 });
  assert.throws(() => authorization.requireRoles({ role:'VENDOR' }, 'HOST'), { status: 403 });
  const user = { role:'HOST' }; assert.equal(authorization.requireRoles(user, 'HOST'), user);
  const err = new AppError(418, 'teapot'); assert.equal(err.status, 418); assert.equal(err.message, 'teapot');
});

test('auth registration, login, token verification, role changes, and secret checks', async () => {
  process.env.JWT_SECRET = '01234567890123456789012345678901';
  let created;
  stub(repositories.users, 'create', async value => { created = value; return { user_id: 17, ...value }; });
  stub(repositories.users, 'update', async (_id, value) => ({ user_id:17, name:'Host', email:'h@test.io', ...value }));
  stub(repositories.queries, 'findUserByEmail', async email => email === 'h@test.io' ? { user_id:17, name:'Host', email, role:'HOST', password_hash:created.password_hash } : null);
  stub(repositories.queries, 'findUserById', async id => id === 17 ? { user_id:id, name:'Host', email:'h@test.io', role:'HOST' } : null);
  await assert.rejects(auth.register({ name:'X', email:'bad', password:'Pass123!', role:'HOST' }), { status:400 });
  await assert.rejects(auth.register({ name:'X', email:'x@y.io', password:'weak', role:'HOST' }), { status:400 });
  await assert.rejects(auth.register({ name:'X', email:'x@y.io', password:'Pass123!', role:'ROOT' }), { status:400 });
  await assert.rejects(auth.register({ name:'X', email:'x@y.io', password:'StrongPass123!', role:'HOST' }), { status:400 });
  await assert.rejects(auth.register({ name:'X', email:'x@y.io', password:'StrongPass123!', role:'HOST', age:121 }), { status:400 });
  const registered = await auth.register({ name:' Host ', email:' H@TEST.IO ', password:'StrongPass123!', role:'HOST', age:'25', phone:' +1 555 123 ', city:' Amravati ' });
  assert.equal(registered.status, 201); assert.equal(registered.body.user.email, 'h@test.io');
  assert.equal(created.name, 'Host'); assert.notEqual(created.password_hash, 'StrongPass123!');
  assert.equal(created.age, 25); assert.equal(created.phone, '+1 555 123'); assert.equal(created.city, 'Amravati');
  assert.equal(created.share_phone_with_invitees, false);
  assert.equal((await auth.login({ email:' H@TEST.IO ', password:'StrongPass123!' })).body.user.user_id, 17);
  await assert.rejects(auth.login({ email:'missing@test.io', password:'x' }), { status:401 });
  await assert.rejects(auth.login({ email:'h@test.io', password:'wrong' }), { status:401 });
  assert.deepEqual(await auth.authenticateToken(registered.body.token), { user_id:17, name:'Host', email:'h@test.io', role:'HOST' });
  assert.deepEqual(await auth.changeRole(17, 'VENDOR'), { user_id:17, name:'Host', email:'h@test.io', role:'VENDOR' });
  await assert.rejects(auth.changeRole(17, 'BAD'), { status:400 });
  await assert.rejects(auth.authenticateToken('invalid'), { status:401 });
  process.env.JWT_SECRET = 'short';
  await assert.rejects(auth.login({ email:'h@test.io', password:'StrongPass123!' }), { status:500 });
});

test('event service validates, scopes, redacts invitee budget, and updates only supported fields', async () => {
  const calls = [];
  stub(repositories.queries, 'listEventsFor', async user => [user]);
  stub(repositories.queries, 'findEventById', async id => ({ event_id:Number(id), host_id:8, budget:500 }));
  stub(repositories.queries, 'isInviteeForEvent', async () => true);
  stub(repositories.queries, 'findHostContactForEvent', async () => ({ host_name: 'Host' }));
  stub(repositories.queries, 'hostOwnsEvent', async () => true);
  stub(repositories.queries, 'listEventBookingsForHost', async (id, userId) => [{ event_id:id, host_id:userId }]);
  stub(repositories.events, 'create', async value => { calls.push(value); return { event_id:4 }; });
  stub(repositories.events, 'updateWhere', async (...args) => { calls.push(args); return { event_id:4 }; });
  stub(repositories.events, 'deleteWhere', async (...args) => { calls.push(args); return true; });
  await assert.rejects(events.list({ role:'VENDOR' }), { status:403 });
  assert.deepEqual(await events.list({ role:'HOST' }), [{ role:'HOST' }]);
  await assert.rejects(events.create(8, {}), { status:400 });
  await events.create(8, { name:' Event ', event_type:'Meetup', event_date:'2026-12-01', start_time:'10:00', duration_hours:'2', attendee_count:'40', budget:'1000' });
  assert.equal(calls[0].name, 'Event'); assert.equal(calls[0].duration_hours, 2); assert.equal(calls[0].host_id, 8);
  await assert.rejects(events.getForUser(1, { role:'HOST', user_id:9 }), { status:403 });
  const guestEvent = await events.getForUser(1, { role:'INVITEE', user_id:3 }); assert.equal('budget' in guestEvent, false);
  assert.deepEqual(await events.getBookingsForUser(1, { role:'HOST', user_id:8 }), [{ event_id:1, host_id:8 }]);
  await assert.rejects(events.getBookingsForUser(1, { role:'HOST', user_id:9 }), { status:403 });
  stub(repositories.queries, 'isInviteeForEvent', async () => false);
  await assert.rejects(events.getForUser(1, { role:'INVITEE', user_id:3 }), { status:403 });
  await assert.rejects(events.update(4, 8, { host_id:1 }), { status:400 });
  await events.update(4, 8, { name:'New', host_id:1 }); assert.deepEqual(calls[1][1], { name:'New' });
  stub(repositories.events, 'updateWhere', async () => null);
  await assert.rejects(events.update(4, 8, { name:'New' }), { status:404 });
  assert.deepEqual(await events.remove(4, 8), { message:'Event deleted' });
  stub(repositories.events, 'deleteWhere', async () => false);
  await assert.rejects(events.remove(4, 8), { status:404 });
});

test('booking workflows validate ownership, status, and host/vendor permissions', async () => {
  const calls = [];
  stub(repositories.queries, 'listBookingsFor', async user => [user]);
  stub(repositories.queries, 'hostOwnsEvent', async () => true);
  stub(repositories.queries, 'createBooking', async value => { calls.push(value); return 21; });
  stub(repositories.queries, 'isBookableListing', async () => true);
  stub(repositories.queries, 'notifyBookingParties', async (...args) => calls.push(args));
  stub(repositories.queries, 'getBookingContacts', async id => ({ booking_id:id, event_id:1, venue_id:null }));
  let capacityCheck = null;
  stub(repositories.queries, 'getCapacityCheck', async () => capacityCheck);
  stub(repositories.queries, 'getConfirmedEventLocation', async () => null);
  stub(repositories.queries, 'isPendingBookingForHost', async () => true);
  stub(repositories.queries, 'isPendingBookingForVendor', async () => true);
  stub(repositories.queries, 'confirmBooking', async (...args) => calls.push(args));
  let cancelRecord = { booking_id:1, status:'PENDING', host_id:5, venue_vendor_id:7 };
  stub(repositories.queries, 'findBookingForCancel', async () => cancelRecord);
  stub(repositories.queries, 'findBookingForReject', async () => cancelRecord);
  stub(repositories.queries, 'updateBookingStatus', async (...args) => calls.push(args));
  await assert.rejects(bookings.list({ role:'INVITEE' }), { status:403 });
  assert.deepEqual(await bookings.list({ role:'HOST' }), [{ role:'HOST' }]);
  await assert.rejects(bookings.create(5, {}), { status:400 });
  assert.equal(await bookings.create(5, { event_id:1, venue_id:2, start_datetime:'2026-01-01', end_datetime:'2026-01-02', agreed_price:'50' }), 21);
  assert.equal(calls[0].agreed_price, 50);
  stub(repositories.queries, 'hostOwnsEvent', async () => false);
  await assert.rejects(bookings.create(5, { event_id:1, venue_id:2, start_datetime:'2026-01-01', end_datetime:'2026-01-02' }), { status:404 });
  await assert.rejects(bookings.confirm({ role:'HOST', user_id:5 }, 1, -1), { status:400 });
  await bookings.confirm({ role:'HOST', user_id:5 }, 1, '30'); assert.deepEqual(calls[2], [1,30]);
  assert.deepEqual(calls[3], [1, 'HOST', 'confirmed']);
  await bookings.confirm({ role:'VENDOR', user_id:7 }, 1);
  assert.deepEqual(calls[5], [1, 'VENDOR', 'confirmed']);
  capacityCheck = { attendee_count:100, venue_name:'Hall', venue_capacity:50 };
  await assert.rejects(bookings.confirm({ role:'VENDOR', user_id:7 }, 1), { status:409, message:/holds 50/ });
  capacityCheck = { attendee_count:10, offering_name:'Catering', min_capacity:20, max_capacity:200 };
  await assert.rejects(bookings.confirm({ role:'VENDOR', user_id:7 }, 1), { status:409, message:/at least 20/ });
  capacityCheck = null;
  await assert.rejects(bookings.cancel({ role:'HOST', user_id:6 }, 1), { status:403 });
  await bookings.cancel({ role:'HOST', user_id:5 }, 1);
  cancelRecord.status = 'CANCELLED';
  await assert.rejects(bookings.cancel({ role:'HOST', user_id:5 }, 1), { status:400 });
  cancelRecord = { booking_id:1, status:'PENDING', host_id:5, venue_vendor_id:7 };
  await assert.rejects(bookings.reject(8, 1), { status:403 });
  await bookings.reject(7, 1);
  cancelRecord.status = 'CONFIRMED';
  await assert.rejects(bookings.reject(7, 1), { status:400 });
});

test('marketplace operations validate and normalize vendor data', async () => {
  const calls=[];
  stub(repositories.queries, 'searchVenues', async query => query);
  stub(repositories.queries, 'searchOfferings', async query => query);
  stub(repositories.venues, 'create', async value => { calls.push(value); return { venue_id:3 }; });
  stub(repositories.vendorOfferings, 'create', async value => { calls.push(value); return { offering_id:4 }; });
  stub(repositories.vendorProfiles, 'findById', async () => null);
  stub(repositories.vendorProfiles, 'create', async value => { calls.push(value); return value; });
  stub(repositories.vendorProfiles, 'update', async (...args) => { calls.push(args); return args; });
  assert.deepEqual(await marketplace.searchVenues({ location:'X' }), { location:'X' });
  assert.deepEqual(await marketplace.searchOfferings({ category:'Food' }), { category:'Food' });
  await assert.rejects(marketplace.createVenue(9, {}), { status:400 });
  assert.equal(await marketplace.createVenue(9, { name:'Hall', address:'Road', capacity:'20', facilities:['A'], base_price:'8' }), 3);
  assert.equal(calls[0].facilities, '["A"]'); assert.equal(calls[0].capacity, 20);
  await assert.rejects(marketplace.createOffering(9, {}), { status:400 });
  assert.equal(await marketplace.createOffering(9, { category:'Food', name:'Meal', offering_type:'PACKAGE', price:'20' }), 4);
  assert.equal(calls[1].price, 20);
  await assert.rejects(marketplace.saveVendorProfile(9, {}), { status:400 });
  await marketplace.saveVendorProfile(9, { business_name:' Shop ', description:' Nice ' });
  assert.equal(calls[2].business_name, 'Shop'); assert.equal(calls[2].description, 'Nice');
  stub(repositories.vendorProfiles, 'findById', async () => ({ vendor_id:9 }));
  await marketplace.saveVendorProfile(9, { business_name:'Updated' }); assert.deepEqual(calls[3][0], 9);
});

test('invitation, budget, and notification services cover success and not-found paths', async () => {
  const calls=[];
  stub(repositories.queries, 'hostOwnsEvent', async () => true);
  stub(repositories.queries, 'createInvitations', async (...args) => { calls.push(args); return []; });
  stub(repositories.queries, 'findInvitationEventDetails', async () => ({ name:'Event', event_date:'2026-12-01', start_time:'10:00' }));
  stub(repositories.queries, 'updateInvitationDelivery', async (...args) => { calls.push(args); });
  stub(repositories.queries, 'listInvitationsForEvent', async (...args) => { calls.push(args); return [{ rsvp_status:'ACCEPTED' }]; });
  stub(repositories.queries, 'listInvitationsFor', async user => [user]);
  stub(repositories.queries, 'updateRsvp', async (...args) => { calls.push(args); return true; });
  stub(repositories.queries, 'findInvitationHost', async () => ({ host_id:2, event_name:'Event' }));
  stub(repositories.queries, 'createNotification', async (...args) => { calls.push(args); });
  stub(repositories.queries, 'findBudgetForEvent', async () => ({ event_id:1 }));
  stub(repositories.queries, 'listNotifications', async id => [id]);
  stub(repositories.queries, 'markNotificationRead', async () => true);
  await assert.rejects(invitations.createForEvent(1, 2, []), { status:400 });
  await assert.rejects(invitations.createForEvent(1, 2, [{ email:'bad' }]), { status:400 });
  await invitations.createForEvent(1, 2, [{ name:'A', email:' A@B.IO ' }]);
  assert.equal(calls[0][1][0].email, 'a@b.io');
  assert.deepEqual(await invitations.listForEvent(1, 2), [{ rsvp_status:'ACCEPTED' }]);
  stub(repositories.queries, 'hostOwnsEvent', async () => false);
  await assert.rejects(invitations.listForEvent(1, 2), { status:404 });
  stub(repositories.queries, 'hostOwnsEvent', async () => true);
  assert.deepEqual(await invitations.listMine({ user_id:1 }), [{ user_id:1 }]);
  await assert.rejects(invitations.rsvp({}, 1, 'MAYBE'), { status:400 });
  await invitations.rsvp({ user_id:2 }, 1, 'ACCEPTED');
  stub(repositories.queries, 'updateRsvp', async () => false);
  await assert.rejects(invitations.rsvp({}, 1, 'DECLINED'), { status:404 });
  assert.deepEqual(await budget.forEvent(1, 1), { event_id:1 });
  stub(repositories.queries, 'findBudgetForEvent', async () => null);
  await assert.rejects(budget.forEvent(1, 1), { status:404 });
  assert.deepEqual(await notifications.listForUser(8), [8]);
  await notifications.markRead(8, 1);
  stub(repositories.queries, 'markNotificationRead', async () => false);
  await assert.rejects(notifications.markRead(8, 1), { status:404 });
});

test('vendor availability and host expense services enforce ownership and booking safety', async () => {
  const calls = [];
  stub(repositories.queries, 'listAvailabilityForVendor', async id => [id]);
  stub(repositories.queries, 'vendorOwnsResource', async () => true);
  stub(repositories.queries, 'confirmedBookingOverlaps', async (...args) => { calls.push(args); return false; });
  stub(repositories.queries, 'findAvailabilityForVendor', async () => true);
  stub(repositories.availabilitySlots, 'create', async value => { calls.push(value); return { slot_id:1, ...value }; });
  stub(repositories.availabilitySlots, 'findById', async () => ({ slot_id:1, venue_id:2, offering_id:null,
    start_datetime:'2026-12-01T10:00:00', end_datetime:'2026-12-01T12:00:00', availability_status:'AVAILABLE' }));
  stub(repositories.availabilitySlots, 'update', async (...args) => { calls.push(args); return { slot_id:1 }; });
  stub(repositories.availabilitySlots, 'delete', async id => { calls.push(id); });
  assert.deepEqual(await availability.list(7), [7]);
  await assert.rejects(availability.create(7, { venue_id:2, offering_id:3, start_datetime:'2026-12-01T10:00', end_datetime:'2026-12-01T11:00' }), { status:400 });
  const slot = await availability.create(7, { venue_id:2, start_datetime:'2026-12-01T10:00', end_datetime:'2026-12-01T11:00' });
  assert.equal(slot.availability_status, 'AVAILABLE');
  await availability.update(7, 1, { availability_status:'BLOCKED' });
  assert.deepEqual(calls.at(-1), [1, { availability_status:'BLOCKED' }]);
  await availability.remove(7, 1);
  stub(repositories.queries, 'confirmedBookingOverlaps', async () => true);
  await assert.rejects(availability.remove(7, 1), { status:409 });

  stub(repositories.queries, 'hostOwnsEvent', async () => true);
  stub(repositories.queries, 'listExpensesForEvent', async () => [{ expense_id:1 }]);
  stub(repositories.queries, 'isBookingForEvent', async () => true);
  stub(repositories.queries, 'findExpenseForHost', async () => true);
  stub(repositories.expenses, 'create', async value => { calls.push(value); return { expense_id:2, ...value }; });
  stub(repositories.expenses, 'findById', async () => ({ event_id:3, description:'Catering', amount:50 }));
  stub(repositories.expenses, 'updateWhere', async (...args) => { calls.push(args); return { expense_id:2 }; });
  stub(repositories.expenses, 'delete', async id => { calls.push(id); });
  assert.deepEqual(await expenses.list(7, 3), [{ expense_id:1 }]);
  await assert.rejects(expenses.create(7, 3, { description:'', amount:-1 }), { status:400 });
  await expenses.create(7, 3, { description:' Catering ', amount:'50', booking_id:'4' });
  assert.equal(calls.at(-1).description, 'Catering');
  await expenses.update(7, 2, { amount:'75' });
  assert.deepEqual(calls.at(-1)[1], { description:'Catering', amount:75, expense_date:null });
  await expenses.remove(7, 2);
});

test('base, read-only, and database repositories bind SQL values and enforce field rules', async () => {
  const calls=[]; const db={ execute:async (sql, params=[])=>{ calls.push([sql,params]); if(sql.startsWith('SELECT')) return [[{ id:2, name:'A' }]]; return [{ insertId:2, affectedRows:1 }]; }, query:async()=>['query'], getConnection:async()=> 'connection' };
  const repo=new BaseRepository(db, 'things', 'id', Entity.Entity);
  await repo.findById(2); assert.deepEqual(calls.at(-1)[1], [2]);
  assert.equal((await repo.findAll({ limit:'5', offset:'2' })).length, 1); assert.deepEqual(calls.at(-1)[1], [5,2]);
  await repo.create({ name:'A', skipped:undefined }); assert.match(calls.at(-2)[0], /INSERT INTO `things`/);
  await repo.update(2, { name:'B' }); await repo.updateWhere(2, { name:'C' }, { owner:3 });
  assert.deepEqual(calls.at(-2)[1], ['C',2,3]);
  await repo.delete(2); await repo.deleteWhere(2, { owner:3 });
  await assert.rejects(repo.create({}), /At least one field/);
  await assert.rejects(repo.create({ 'name;drop':'x' }), /Invalid field/);
  const restricted=new BaseRepository(db,'things','id',Entity.User); await assert.rejects(restricted.update(2,{ admin:true }), /Invalid field/);
  assert.throws(()=>new BaseRepository(db,'things;drop','id',Entity.Entity), /identifiers/);
  const view=new ReadOnlyRepository(db,'view_items','item_id',Entity.Entity); await view.findById(1); await view.findAll();
  assert.throws(()=>new ReadOnlyRepository(db,'view;drop','id',Entity.Entity), /mapping/);
  const pool={ execute:(...args)=>args, query:(...args)=>args, getConnection:()=>42 }; const adapter=new DatabaseRepository(pool);
  assert.deepEqual(adapter.execute('SQL'), ['SQL',[]]); assert.deepEqual(adapter.query('Q'), ['Q',[]]); assert.equal(adapter.getConnection(),42);
});

test('auth middleware, error middleware, and async wrapper forward outcomes', async () => {
  let status, body, forwarded, user;
  const res={ status(n){status=n;return this;}, json(value){body=value;return this;} };
  await authenticate({ headers:{ authorization:'bad' } }, res, err=>forwarded=err);
  assert.equal(status,401); assert.match(body.message,/required/);
  process.env.JWT_SECRET='01234567890123456789012345678901';
  stub(repositories.queries, 'findUserById', async id=>({ user_id:id, role:'HOST' }));
  const token=require('jsonwebtoken').sign({ sub:'1' }, process.env.JWT_SECRET);
  await authenticate({ headers:{ authorization:`Bearer ${token}` } }, res, err=>forwarded=err);
  assert.equal(forwarded, undefined);
  const req={ user:{ role:'VENDOR' } }; allowRoles('HOST')(req,res,err=>forwarded=err); assert.equal(forwarded.status,403);
  const nextErr=new Error('async'); await asyncHandler(async()=>{ throw nextErr; })({}, {}, err=>forwarded=err); assert.equal(forwarded,nextErr);
  notFound({ method:'GET', originalUrl:'/x' }, res); assert.equal(status,404); assert.equal(body.message,'Route not found: GET /x');
  const old=console.error; console.error=()=>{};
  try {
    errorHandler({ status:400, message:'bad request' }, {}, res, ()=>{}); assert.equal(body.message,'bad request');
    errorHandler({ code:'ER_DUP_ENTRY' }, {}, res, ()=>{}); assert.equal(status,409);
    errorHandler({ code:'ER_NO_REFERENCED_ROW_2' }, {}, res, ()=>{}); assert.equal(status,400);
    errorHandler({ errno:3819 }, {}, res, ()=>{}); assert.equal(status,400);
    process.env.NODE_ENV='production'; errorHandler(new Error('secret details'), {}, res, ()=>{}); assert.equal(body.message,'Internal server error');
  } finally { console.error=old; }
});

test('all route modules load and declare expected HTTP route surfaces', () => {
  const routeFiles=['auth','events','marketplace','bookings','invitations','budget','notifications','availability','expenses'];
  const routers=routeFiles.map(name=>require(`../src/routes/${name}.routes`));
  const routes=routers.flatMap(router=>router.stack.filter(layer=>layer.route).map(layer=>`${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`));
  for(const expected of ['POST /register','POST /login','PATCH /role','GET /','POST /','GET /:id','GET /:id/bookings','PUT /:id','DELETE /:id','GET /venues','GET /offerings','POST /vendors/profile','GET /vendors/profile','PATCH /:id/confirm','PATCH /:id/cancel','PATCH /:id/reject','POST /events/:id/invitations','GET /events/:id/invitations','GET /invitations/mine','PATCH /invitations/:id/rsvp','GET /events/:id/budget','PATCH /:id/read','GET /','POST /','PATCH /:id','DELETE /:id','GET /events/:id/expenses','POST /events/:id/expenses']) assert(routes.includes(expected), `Missing route ${expected}`);
});

test('booking creation rejects over-capacity requests and lists filter upcoming/past', async () => {
  stub(repositories.queries, 'hostOwnsEvent', async () => true);
  stub(repositories.queries, 'isBookableListing', async () => true);
  stub(repositories.queries, 'createBooking', async () => 9);
  stub(repositories.queries, 'notifyBookingParties', async () => {});
  stub(repositories.queries, 'getCapacityCheck', async () => ({ attendee_count:80, offering_name:'Menu', max_capacity:60 }));
  const request = { event_id:1, offering_id:3, start_datetime:'2026-01-01 10:00:00', end_datetime:'2026-01-01 12:00:00' };
  await assert.rejects(bookings.create(5, request), { status:409, message:/up to 60/ });
  const seen = [];
  stub(repositories.queries, 'listBookingsFor', async (user, when) => { seen.push(when); return []; });
  await bookings.list({ role:'VENDOR', user_id:7 }, 'past');
  await bookings.list({ role:'VENDOR', user_id:7 });
  assert.deepEqual(seen, ['past', null]);
  await assert.rejects(bookings.list({ role:'VENDOR', user_id:7 }, 'soon'), { status:400 });
});

test('event recommendations use the event requirements and reminders notify once', async () => {
  const event = { event_id:4, host_id:5, event_date:'2026-06-01', start_time:'18:00:00', duration_hours:3, attendee_count:80, budget:'1000' };
  stub(repositories.events, 'findById', async () => event);
  let criteria;
  stub(repositories.queries, 'searchVenues', async query => { criteria = query; return [{ venue_id:1, base_price:500 }]; });
  stub(repositories.queries, 'searchOfferings', async () => []);
  const result = await marketplace.recommendForEvent(5, 4);
  assert.deepEqual(criteria, { attendees:80, max_price:'1000', start_datetime:'2026-06-01 18:00:00', end_datetime:'2026-06-01 21:00:00' });
  assert.equal(result.venues[0].budget_share, 0.5);
  assert.equal(result.message, null);
  await assert.rejects(marketplace.recommendForEvent(6, 4), { status:404 });
  stub(repositories.queries, 'searchVenues', async () => []);
  assert.match((await marketplace.recommendForEvent(5, 4)).message, /No venues/);

  const reminders = require('../src/services/reminder.service');
  const sent = [];
  stub(repositories.queries, 'findDueReminders', async () => [
    { invitation_id:1, invitee_user_id:8, event_name:'Gala', event_date:'2026-06-01', start_time:'18:00:00' },
    { invitation_id:2, invitee_user_id:9, event_name:'Gala', event_date:'2026-06-01', start_time:'18:00:00' }]);
  stub(repositories.queries, 'markReminderSent', async id => id === 1);
  stub(repositories.queries, 'createNotification', async (...args) => sent.push(args));
  assert.deepEqual(await reminders.sendDueReminders(24), { sent:1 });
  assert.equal(sent[0][0], 8);
  assert.equal(sent[0][2], 'EVENT_REMINDER');
  assert.equal(reminders.startReminderScheduler(0), null);
});
