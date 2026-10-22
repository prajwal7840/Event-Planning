function notFound(req, res) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
}

function errorHandler(err, _req, res, _next) {
  if (err.status && err.status < 500) return res.status(err.status).json({ message: err.message });
  console.error(err);
  if (err.code === "ER_DUP_ENTRY") {
    return res.status(409).json({ message: "A record with these details already exists" });
  }
  if (err.code === "ER_NO_REFERENCED_ROW_2") {
    return res.status(400).json({ message: "A referenced record does not exist" });
  }
  if (err.code === "ER_CHECK_CONSTRAINT_VIOLATED" || err.errno === 3819) {
    return res.status(400).json({ message: "The request violates a database rule" });
  }
  res.status(500).json({
    message: process.env.NODE_ENV === "production" ? "Internal server error" : (err.message || "Internal server error")
  });
}

module.exports = { notFound, errorHandler };
