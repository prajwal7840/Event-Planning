# Event Planning API

Starter REST API for the Event Planning and Management Application using Node.js, Express and MySQL. It connects to the existing `eventplanningdb` database; it does **not** create or modify the schema.

## 1. Requirements
- Node.js 18+
- MySQL server running
- Existing database named `eventplanningdb` with the project tables, views and procedures

## 2. Setup
1. Extract this folder and open it in VS Code.
2. In the terminal, run `npm install`.
3. Copy `.env.example` to `.env`.
   - Windows PowerShell: `Copy-Item .env.example .env`
   - macOS/Linux: `cp .env.example .env`
4. Edit `.env` with your MySQL credentials.
5. Set `JWT_SECRET` to a random secret of at least 32 characters.
6. Run `npm run dev`.

For a full demo catalog, run `npm run seed:demo`. This safely adds eight sample venues and eight services, a demo host with six upcoming events and booking examples, matching availability slots, a demo invitee with invitations, and sample notifications. It does not change the schema and can be run again safely.

Demo sign-ins:
- Host: `demo.host@gather.local` / `GatherHost2026!`
- Invitee: `demo.guest@gather.local` / `GatherGuest2026!`
- Sample vendor: `gather-sample-vendor@example.invalid` / `GatherVendor2026!`

The demo seed resets these demo accounts to the passwords above each time it runs. It does not reset any other account.

## Domain and data access
The domain objects in `src/domain/entities.js` match the live schema inspected for this project: `User`, `VendorProfile`, `Event`, `Invitation`, `Venue`, `VendorOffering`, `Booking`, `Notification`, `AvailabilitySlot`, and `Expense`. `EventBudgetSummary` and `InviteeEvent` are read models for the two database views.

Routes delegate use cases to modules in `src/services/`; services own validation and workflow rules, while route files handle HTTP/authentication. All SQL is in `src/repositories/`, backed by the shared pool in `src/config/db.js`. Entity repositories provide `findById`, `findAll`, `create`, `update`, and `delete`; `ApplicationRepository` contains domain queries that need joins, transactions, views, or stored procedures. View repositories are read-only. Invitation persistence and its transaction are handled by the repository.

Repository mappings use the primary keys defined by the schema, including `availability_slot.slot_id` and `expense.expense_id`. The repositories for `v_event_budget_summary` and `v_invitee_event` are read-only. The API does not create or alter tables; tables and views must already exist in `eventplanningdb`.

API base URL: `http://localhost:5000`
Gather landing page: `http://localhost:5000/`
Event planning workspace: `http://localhost:5000/app`
Interactive API docs: `http://localhost:5000/api-docs`
Health check: `GET http://localhost:5000/api/health`

## 3. Authentication
Register: `POST /api/auth/register` (creates the account and returns a JWT)
```json
{"name":"Test Host","email":"host@example.com","password":"StrongPass123!","role":"HOST"}
```
Login: `POST /api/auth/login`
```json
{"email":"host@example.com","password":"StrongPass123!"}
```
Registration and login both return a token. The Gather app stores it for the session and sends it automatically. For manual API calls, add this header to protected requests:
`Authorization: Bearer YOUR_TOKEN`

Roles: `HOST`, `VENDOR`, `INVITEE`.

New passwords must be at least 8 characters and include an uppercase letter, lowercase letter, number, and special character. The API enforces this rule during registration; sign-in continues to accept existing passwords. Authentication and authorization are handled in layers. The auth service hashes passwords and issues signed JWTs at login. Protected-route middleware verifies the JWT and loads the current user and role from the database. Role middleware checks the roles allowed for a route, while services check access to specific records (for example, a host must own an event) and repositories apply those ownership conditions in their database queries. The password hash is never returned in the account response. Configure `JWT_SECRET` with at least 32 characters.

**Vendor onboarding note:** registration creates the `app_user` record. The vendor must also have a `vendor_profile` record before creating listings. This starter intentionally does not silently create a vendor profile because your schema may require a business name. Add a vendor profile endpoint/workflow before vendor listing creation.

## 4. Endpoint list

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/api/health` | Public | Check API and database |
| POST | `/api/auth/register` | Public | Register account |
| POST | `/api/auth/login` | Public | Login and get JWT |
| GET | `/api/events` | Host / invitee | List accessible events |
| POST | `/api/events` | Host | Create event |
| GET | `/api/events/:id` | Host / invitee | Event details |
| PUT | `/api/events/:id` | Host | Update own event |
| DELETE | `/api/events/:id` | Host | Delete own event |
| GET | `/api/venues?min_capacity=100&max_price=50000&location=Amravati` | Public | Search venues |
| POST | `/api/venues` | Vendor | Add venue |
| GET | `/api/offerings?category=Catering&attendees=100&max_price=30000` | Public | Search services/packages |
| POST | `/api/offerings` | Vendor | Add offering |
| GET | `/api/bookings` | Host / vendor | List bookings visible to role |
| POST | `/api/bookings` | Host | Create pending booking |
| PATCH | `/api/bookings/:id/confirm` | Host | Confirm via stored procedure |
| PATCH | `/api/bookings/:id/cancel` | Host / relevant vendor | Cancel booking |
| PATCH | `/api/bookings/:id/reject` | Relevant vendor | Reject pending booking |
| POST | `/api/events/:id/invitations` | Host | Add invitees |
| GET | `/api/invitations/mine` | Invitee | List invitations |
| PATCH | `/api/invitations/:id/rsvp` | Invitee | Accept/decline invitation |
| GET | `/api/events/:id/budget` | Host | Read budget view |
| GET | `/api/notifications` | Authenticated user | List notifications |
| PATCH | `/api/notifications/:id/read` | Authenticated user | Mark notification read |

## 5. Example: create event
`POST /api/events`, header `Authorization: Bearer YOUR_TOKEN`, body:
```json
{
  "name": "College Tech Fest",
  "event_type": "College Event",
  "event_date": "2026-12-15",
  "start_time": "10:00:00",
  "duration_hours": 5,
  "attendee_count": 100,
  "budget": 50000
}
```
`host_id` is taken from the JWT token, not from the request body.

## 6. Important schema notes
- This code expects the column names described in your project notes, including `booking.start_datetime`, `booking.end_datetime`, `event.start_time`, and `v_event_budget_summary`.
- Booking confirmation calls `sp_confirm_booking(IN p_booking_id BIGINT UNSIGNED, IN p_agreed_price DECIMAL(12,2))`. The optional `agreed_price` request body can override the booking/listing price; the API passes `NULL` when it is omitted.
- Booking creation makes a `PENDING` booking. Do not directly set it to `CONFIRMED`; use the stored procedure and database validation rules.
- Your schema may use `availability_slot.start_datetime` / `end_datetime` or different names. This starter does not yet manage availability slots; add that route after verifying exact schema.
- Do not expose passwords, password hashes, JWT secrets, or database credentials in API responses.
- For production, add rate limiting, stricter input validation, email verification, secure deployment settings, and tests. Review cancellation policy and ensure your stored procedures/triggers cover all booking concurrency cases.
- CORS is restricted to `CLIENT_ORIGIN`; update it for your React app's URL.
