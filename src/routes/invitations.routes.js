const router = require('express').Router();
const { authenticate, allowRoles } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const invitationService = require('../services/invitation.service');

router.post('/events/:id/invitations', authenticate, allowRoles('HOST'), asyncHandler(async (req, res) => {
  const invitations = await invitationService.createForEvent(req.user.user_id, req.params.id, req.body.invitees);
  res.status(201).json({ message: 'Invitations saved', invitations });
}));
router.get('/invitations/mine', authenticate, allowRoles('INVITEE'), asyncHandler(async (req, res) => res.json(await invitationService.listMine(req.user))));
router.patch('/invitations/:id/rsvp', authenticate, allowRoles('INVITEE'), asyncHandler(async (req, res) => {
  const { rsvp_status } = req.body;
  await invitationService.rsvp(req.user, req.params.id, rsvp_status);
  res.json({ message: 'RSVP updated', rsvp_status });
}));

module.exports = router;
