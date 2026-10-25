const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { users, queries } = require('../repositories');
const AppError = require('../utils/appError');
const jwtSecret = () => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new AppError(500, 'Configure a JWT_SECRET of at least 32 characters in .env');
  }
  return process.env.JWT_SECRET;
};
const { validRoles } = require('./authorization.service');
const strongPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
function issueToken(userId) {
  return jwt.sign({ sub: String(userId) }, jwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '1d' });
}

async function register({ name, email, password, role, age, phone, city, share_phone_with_invitees }) {
  const sharePhone = share_phone_with_invitees === true || share_phone_with_invitees === 'true' || share_phone_with_invitees === 'on';
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!name || !normalizedEmail.includes('@'))
    throw new AppError(400, 'A name and valid email address are required');
  const numericAge = Number(age);
  if (!Number.isInteger(numericAge) || numericAge < 1 || numericAge > 120)
    throw new AppError(400, 'Age must be a whole number between 1 and 120');
  if (phone != null && (typeof phone !== 'string' || phone.trim().length > 30))
    throw new AppError(400, 'Phone number must be 30 characters or fewer');
  if (city != null && (typeof city !== 'string' || city.trim().length > 100))
    throw new AppError(400, 'City must be 100 characters or fewer');
  if (sharePhone && !phone) throw new AppError(400, 'Add a phone number before sharing it with invitees');
  if (typeof password !== 'string' || !strongPassword.test(password))
    throw new AppError(400, 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character');
  if (!validRoles.includes(role)) throw new AppError(400, 'role must be HOST, VENDOR or INVITEE');
  jwtSecret();
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await users.create({ name: String(name).trim(), email: normalizedEmail, password_hash: passwordHash, role,
    age: numericAge, phone: phone ? phone.trim() : null, city: city ? city.trim() : null,
    share_phone_with_invitees: sharePhone });
  const token = issueToken(user.user_id);
  return { status: 201, body: { message: 'Account created', token, user: { user_id: user.user_id, name: user.name, email: user.email, role: user.role } } };
}

async function login({ email, password }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const user = await queries.findUserByEmail(normalizedEmail);
  if (!user || !(await bcrypt.compare(String(password || ''), user.password_hash))) throw new AppError(401, 'Invalid email or password');
  const token = issueToken(user.user_id);
  return { status: 200, body: { message: 'Login successful', token, user: { user_id: user.user_id, name: user.name, email: user.email, role: user.role } } };
}

async function changeRole(userId, role) {
  if (!validRoles.includes(role)) throw new AppError(400, 'role must be HOST, VENDOR or INVITEE');
  const user = await users.update(userId, { role });
  return { user_id: user.user_id, name: user.name, email: user.email, role: user.role };
}

async function getProfile(userId) {
  const profile = await users.findById(userId);
  if (!profile) throw new AppError(404, 'Profile not found');
  const { password_hash, ...safe } = profile.toJSON();
  return safe;
}

async function updateProfile(userId, data) {
  const changes = {};
  if (Object.hasOwn(data, 'phone')) {
    if (data.phone != null && (typeof data.phone !== 'string' || data.phone.trim().length > 30)) throw new AppError(400, 'Phone number must be 30 characters or fewer');
    changes.phone = data.phone ? data.phone.trim() : null;
  }
  if (Object.hasOwn(data, 'city')) {
    if (data.city != null && (typeof data.city !== 'string' || data.city.trim().length > 100)) throw new AppError(400, 'City must be 100 characters or fewer');
    changes.city = data.city ? data.city.trim() : null;
  }
  if (Object.hasOwn(data, 'share_phone_with_invitees')) {
    if (typeof data.share_phone_with_invitees !== 'boolean') throw new AppError(400, 'share_phone_with_invitees must be a boolean');
    changes.share_phone_with_invitees = data.share_phone_with_invitees;
  }
  if (changes.share_phone_with_invitees && !(changes.phone || (await users.findById(userId))?.phone))
    throw new AppError(400, 'Add a phone number before sharing it with invitees');
  if (!Object.keys(changes).length) throw new AppError(400, 'Provide phone, city, or share_phone_with_invitees');
  await users.update(userId, changes);
  return getProfile(userId);
}

async function authenticateToken(token) {
  const secret = jwtSecret();
  let payload;
  try {
    payload = jwt.verify(token, secret);
  } catch (_error) {
    throw new AppError(401, 'Invalid or expired token');
  }
  const userId = Number(payload.sub);
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new AppError(401, 'Invalid or expired token');
  const user = await queries.findUserById(userId);
  if (!user || !validRoles.includes(user.role)) throw new AppError(401, 'Invalid or expired token');
  return user;
}

module.exports = { register, login, changeRole, getProfile, updateProfile, authenticateToken };
