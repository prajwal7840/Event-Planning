require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const authRoutes = require("./src/routes/auth.routes");
const eventRoutes = require("./src/routes/events.routes");
const marketplaceRoutes = require("./src/routes/marketplace.routes");
const bookingRoutes = require("./src/routes/bookings.routes");
const invitationRoutes = require("./src/routes/invitations.routes");
const budgetRoutes = require("./src/routes/budget.routes");
const notificationRoutes = require("./src/routes/notifications.routes");
const { notFound, errorHandler } = require("./src/middleware/errors");

const app = express();
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || "http://localhost:5173"
}));
app.use(express.json({ limit: "1mb" }));

// Serve Swagger UI using the OpenAPI document in the project root.
const swaggerUiDist = require("swagger-ui-dist").getAbsoluteFSPath();
app.use("/swagger-ui-assets", express.static(swaggerUiDist));
app.get("/openapi.yaml", (_req, res) => {
  res.set("Cache-Control", "no-store").type("text/yaml").sendFile(path.join(__dirname, "openapi.yaml"));
});
app.get("/api-docs", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Event Planning API - Swagger UI</title>
<link rel="stylesheet" href="/swagger-ui-assets/swagger-ui.css"></head>
<body><div id="swagger-ui"></div>
<script src="/swagger-ui-assets/swagger-ui-bundle.js"></script>
<script>window.onload = () => SwaggerUIBundle({ url: "/openapi.yaml", dom_id: "#swagger-ui", deepLinking: true });</script>
</body></html>`);
});

app.use("/app-assets", express.static(path.join(__dirname, "public")));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/login", (_req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/app", (_req, res) => res.sendFile(path.join(__dirname, "public", "dashboard.html")));

app.get("/api/health", async (_req, res, next) => {
  try {
    const { db } = require("./src/services");
    await db.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (err) {
    next(err);
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/events", eventRoutes);
app.use("/api", marketplaceRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api", invitationRoutes);
app.use("/api", budgetRoutes);
app.use("/api/notifications", notificationRoutes);

app.use(notFound);
app.use(errorHandler);

const port = Number(process.env.PORT || 5000);
app.listen(port, () => console.log(`Event Planning API listening on port ${port}`));
