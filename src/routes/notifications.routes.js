const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const notificationService = require('../services/notification.service');

router.use(authenticate);
router.get('/', asyncHandler(async (req, res) => res.json(await notificationService.listForUser(req.user.user_id))));
router.patch('/:id/read', asyncHandler(async (req, res) => {
  await notificationService.markRead(req.user.user_id, req.params.id);
  res.json({ message: 'Notification marked as read' });
}));
module.exports = router;
