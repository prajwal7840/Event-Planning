-- Pending venue and service bookings reserve an estimated amount in the event budget.
-- The final confirmed price still replaces the estimate through sp_confirm_booking.
CREATE OR REPLACE VIEW v_event_budget_summary AS
SELECT
  e.event_id,
  e.host_id,
  e.name,
  e.budget,
  COALESCE(bc.total, 0) AS booking_costs,
  COALESCE(el.total, 0) AS event_level_expenses,
  COALESCE(bc.total, 0) + COALESCE(el.total, 0) AS committed_total,
  e.budget - (COALESCE(bc.total, 0) + COALESCE(el.total, 0)) AS budget_remaining,
  (COALESCE(bc.total, 0) + COALESCE(el.total, 0)) > e.budget AS is_over_budget
FROM `event` e
LEFT JOIN (
  SELECT costs.event_id, SUM(costs.cost) AS total
  FROM (
    SELECT
      b.event_id,
      b.booking_id,
      GREATEST(
        CASE WHEN b.status IN ('PENDING', 'CONFIRMED')
          THEN COALESCE(b.agreed_price, v.base_price, vo.price, 0)
          ELSE 0
        END,
        COALESCE(SUM(x.amount), 0)
      ) AS cost
    FROM booking b
    LEFT JOIN venue v ON v.venue_id = b.venue_id
    LEFT JOIN vendor_offering vo ON vo.offering_id = b.offering_id
    LEFT JOIN expense x ON x.booking_id = b.booking_id
    GROUP BY b.event_id, b.booking_id, b.status, b.agreed_price, v.base_price, vo.price
  ) costs
  GROUP BY costs.event_id
) bc ON bc.event_id = e.event_id
LEFT JOIN (
  SELECT event_id, SUM(amount) AS total
  FROM expense
  WHERE booking_id IS NULL
  GROUP BY event_id
) el ON el.event_id = e.event_id;
