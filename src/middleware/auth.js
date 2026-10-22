const authService = require('../services/auth.service');
const authorizationService = require('../services/authorization.service');

async function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token, extra] = header.split(" ");
  if (scheme !== "Bearer" || !token || extra) {
    return res.status(401).json({ message: "Authentication token required" });
  }

  try {
    req.user = await authService.authenticateToken(token);
    next();
  } catch (error) {
    next(error);
  }
}

function allowRoles(...roles) {
  return (req, res, next) => {
    try {
      authorizationService.requireRoles(req.user, ...roles);
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { authenticate, allowRoles };
