const router = require('express').Router();
const { authenticate, allowRoles } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const expenseService = require('../services/expense.service');

router.get('/events/:id/expenses', authenticate, allowRoles('HOST'), asyncHandler(async (req, res) =>
  res.json(await expenseService.list(req.user.user_id, req.params.id))));
router.post('/events/:id/expenses', authenticate, allowRoles('HOST'), asyncHandler(async (req, res) =>
  res.status(201).json(await expenseService.create(req.user.user_id, req.params.id, req.body))));
router.patch('/expenses/:id', authenticate, allowRoles('HOST'), asyncHandler(async (req, res) =>
  res.json(await expenseService.update(req.user.user_id, req.params.id, req.body))));
router.delete('/expenses/:id', authenticate, allowRoles('HOST'), asyncHandler(async (req, res) =>
  res.json(await expenseService.remove(req.user.user_id, req.params.id))));

module.exports = router;
