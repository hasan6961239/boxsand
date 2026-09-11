import cron from 'node-cron';
import { logger } from './logger.js';
import { dueReminders, settleReminder } from './tools/reminders.js';
import { sendText } from './whatsapp.js';

export function startScheduler() {
  // Every minute: fire anything that has come due. This is what makes the bot
  // able to message you first — unlike the official API, there is no 24-hour window.
  cron.schedule('* * * * *', async () => {
    const due = dueReminders();
    for (const reminder of due) {
      try {
        await sendText(reminder.phone, `⏰ تذكير: ${reminder.text}`);
        settleReminder(reminder);
        logger.info({ id: reminder.id }, 'تم إرسال تذكير');
      } catch (err) {
        logger.error({ err: err.message, id: reminder.id }, 'فشل إرسال تذكير — بنحاول بعدين');
      }
    }
  });

  logger.info('⏰ مجدول التذكيرات شغّال');
}
