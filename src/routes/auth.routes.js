const router = require('express').Router();
const authService = require('../services/auth.service');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate } = require('../middleware/auth');

router.post('/register', asyncHandler(async (req, res) => {
  const result = await authService.register(req.body);
  res.status(result.status).json(result.body);
}));

router.post('/login', asyncHandler(async (req, res) => {
  const result = await authService.login(req.body);
  res.status(result.status).json(result.body);
}));

router.patch('/role', authenticate, asyncHandler(async (req, res) => {
  const user = await authService.changeRole(req.user.user_id, req.body.role);
  res.json({ message: 'Workspace changed', user });
}));

module.exports = router;
