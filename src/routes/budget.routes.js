const router = require('express').Router();
const { authenticate, allowRoles } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const budgetService = require('../services/budget.service');

router.get('/events/:id/budget', authenticate, allowRoles('HOST'), asyncHandler(async (req, res) => {
  res.json(await budgetService.forEvent(req.user.user_id, req.params.id));
}));
module.exports = router;
