const router = require('express').Router();
const { authenticate, allowRoles } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const marketplace = require('../services/marketplace.service');

router.get('/venues', asyncHandler(async (req, res) => res.json(await marketplace.searchVenues(req.query))));
router.get('/offerings', asyncHandler(async (req, res) => res.json(await marketplace.searchOfferings(req.query))));
router.post('/vendors/profile', authenticate, allowRoles('VENDOR'), asyncHandler(async (req, res) => {
  const profile = await marketplace.saveVendorProfile(req.user.user_id, req.body);
  res.json({ message: 'Vendor profile saved', profile });
}));
router.post('/venues', authenticate, allowRoles('VENDOR'), asyncHandler(async (req, res) => {
  const venue_id = await marketplace.createVenue(req.user.user_id, req.body);
  res.status(201).json({ message: 'Venue created', venue_id });
}));
router.post('/offerings', authenticate, allowRoles('VENDOR'), asyncHandler(async (req, res) => {
  const offering_id = await marketplace.createOffering(req.user.user_id, req.body);
  res.status(201).json({ message: 'Offering created', offering_id });
}));

module.exports = router;
