const router = require('express').Router();
const { authenticate, allowRoles } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const bookingService = require('../services/booking.service');

router.use(authenticate);
router.get('/', asyncHandler(async (req, res) => res.json(await bookingService.list(req.user))));
router.post('/', allowRoles('HOST'), asyncHandler(async (req, res) => {
  const booking_id = await bookingService.create(req.user.user_id, req.body);
  res.status(201).json({ message: 'Booking request created', booking_id, status: 'PENDING' });
}));
router.patch('/:id/confirm', allowRoles('HOST'), asyncHandler(async (req, res) => {
  await bookingService.confirm(req.user.user_id, req.params.id, req.body?.agreed_price);
  res.json({ message: 'Booking confirmation procedure executed' });
}));
router.patch('/:id/cancel', asyncHandler(async (req, res) => {
  await bookingService.cancel(req.user, req.params.id);
  res.json({ message: 'Booking cancelled' });
}));
router.patch('/:id/reject', allowRoles('VENDOR'), asyncHandler(async (req, res) => {
  await bookingService.reject(req.user.user_id, req.params.id);
  res.json({ message: 'Booking rejected' });
}));

module.exports = router;
