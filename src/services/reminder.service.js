const { queries } = require('../repositories');

async function sendDueReminders(hoursAhead = Number(process.env.REMINDER_HOURS_AHEAD || 24)) {
  const due = await queries.findDueReminders(hoursAhead);
  let sent = 0;
  for (const reminder of due) {
    if (!await queries.markReminderSent(reminder.invitation_id)) continue;
    const when = `${String(reminder.event_date).slice(0, 10)} at ${String(reminder.start_time).slice(0, 5)}`;
    await queries.createNotification(reminder.invitee_user_id, `Reminder: ${reminder.event_name} is on ${when}. Open your invitation for the latest details.`, 'EVENT_REMINDER');
    sent += 1;
  }
  return { sent };
}

function startReminderScheduler(intervalMinutes = Number(process.env.REMINDER_INTERVAL_MINUTES || 60)) {
  if (!(intervalMinutes > 0)) return null;
  const run = () => sendDueReminders().catch(error => console.error('Reminder run failed:', error.message));
  run();
  return setInterval(run, intervalMinutes * 60 * 1000).unref();
}

module.exports = { sendDueReminders, startReminderScheduler };
