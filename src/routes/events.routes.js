const router = require('express').Router();
const { authenticate, allowRoles } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const eventService = require('../services/event.service');

router.use(authenticate);
router.get('/', asyncHandler(async (req, res) => res.json(await eventService.list(req.user))));
router.post('/', allowRoles('HOST'), asyncHandler(async (req, res) => {
  const event = await eventService.create(req.user.user_id, req.body);
  res.status(201).json({ message: 'Event created', event_id: event.event_id });
}));
router.get('/:id', asyncHandler(async (req, res) => res.json(await eventService.getForUser(req.params.id, req.user))));
router.put('/:id', allowRoles('HOST'), asyncHandler(async (req, res) => res.json(await eventService.update(req.params.id, req.user.user_id, req.body))));
router.delete('/:id', allowRoles('HOST'), asyncHandler(async (req, res) => res.json(await eventService.remove(req.params.id, req.user.user_id))));

module.exports = router;
