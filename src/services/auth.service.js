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

async function register({ name, email, password, role }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!name || !normalizedEmail.includes('@'))
    throw new AppError(400, 'A name and valid email address are required');
  if (typeof password !== 'string' || !strongPassword.test(password))
    throw new AppError(400, 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character');
  if (!validRoles.includes(role)) throw new AppError(400, 'role must be HOST, VENDOR or INVITEE');
  jwtSecret();
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await users.create({ name: String(name).trim(), email: normalizedEmail, password_hash: passwordHash, role });
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

module.exports = { register, login, changeRole, authenticateToken };
