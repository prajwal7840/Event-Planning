const router = require('express').Router();
const { authenticate, allowRoles } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const availability = require('../services/availability.service');

router.use(authenticate, allowRoles('VENDOR'));
router.get('/', asyncHandler(async (req, res) => res.json(await availability.list(req.user.user_id))));
router.post('/', asyncHandler(async (req, res) => res.status(201).json(await availability.create(req.user.user_id, req.body))));
router.patch('/:id', asyncHandler(async (req, res) => res.json(await availability.update(req.user.user_id, req.params.id, req.body))));
router.delete('/:id', asyncHandler(async (req, res) => res.json(await availability.remove(req.user.user_id, req.params.id))));

module.exports = router;
