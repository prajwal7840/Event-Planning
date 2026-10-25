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
router.get('/vendors/profile', authenticate, allowRoles('VENDOR'), asyncHandler(async (req, res) => res.json(await marketplace.vendorData(req.user.user_id))));
router.post('/venues', authenticate, allowRoles('VENDOR'), asyncHandler(async (req, res) => {
  const venue_id = await marketplace.createVenue(req.user.user_id, req.body);
  res.status(201).json({ message: 'Venue created', venue_id });
}));
router.post('/offerings', authenticate, allowRoles('VENDOR'), asyncHandler(async (req, res) => {
  const offering_id = await marketplace.createOffering(req.user.user_id, req.body);
  res.status(201).json({ message: 'Offering created', offering_id });
}));
router.patch('/offerings/:id', authenticate, allowRoles('VENDOR'), asyncHandler(async (req, res) => res.json(await marketplace.updateOffering(req.user.user_id, req.params.id, req.body))));
router.delete('/offerings/:id', authenticate, allowRoles('VENDOR'), asyncHandler(async (req, res) => res.json(await marketplace.deleteOffering(req.user.user_id, req.params.id))));
router.patch('/venues/:id', authenticate, allowRoles('VENDOR'), asyncHandler(async (req, res) => res.json(await marketplace.updateVenue(req.user.user_id, req.params.id, req.body))));
router.delete('/venues/:id', authenticate, allowRoles('VENDOR'), asyncHandler(async (req, res) => res.json(await marketplace.deleteVenue(req.user.user_id, req.params.id))));

module.exports = router;
