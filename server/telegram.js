const https = require('https');
const db = require('./database');

let botToken = null;
let chatId = null;
let isEnabled = false;
// Track per-item, per-reminder-state to avoid duplicates.
// Key format: reminded_${itemId}_${dueDate}_Tminus${days}  (e.g. reminded_xyz_2026-08-01_Tminus2)
let notifiedDates = {};

function initTelegram() {
  const settings = db.getSettings();
  botToken = settings.telegram_bot_token || null;
  chatId = settings.telegram_chat_id || null;
  isEnabled = settings.telegram_notifications_enabled === 'true';

  if (botToken && chatId && isEnabled) {
    console.log('[Telegram] Bot enabled and configured');
  } else {
    console.log('[Telegram] Bot not configured or disabled');
  }
}

function configureTelegram(token, chatId) {
  const settings = db.getSettings();
  settings.telegram_bot_token = token;
  settings.telegram_chat_id = chatId;
  settings.telegram_notifications_enabled = 'true';

  // Save settings to database
  db.updateSetting('telegram_bot_token', token);
  db.updateSetting('telegram_chat_id', chatId);
  db.updateSetting('telegram_notifications_enabled', 'true');

  botToken = token;
  chatId = chatId;
  isEnabled = true;

  console.log('[Telegram] Bot configured successfully');
}

function disableTelegram() {
  const settings = db.getSettings();
  settings.telegram_notifications_enabled = 'false';
  db.updateSetting('telegram_notifications_enabled', 'false');
  isEnabled = false;
  console.log('[Telegram] Bot disabled');
}

function sendMessage(message) {
  if (!isEnabled || !botToken || !chatId) {
    console.log('[Telegram] Cannot send message: not configured or disabled');
    return Promise.reject(new Error('Telegram bot not configured'));
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const data = JSON.stringify({
    chat_id: chatId,
    text: message,
    parse_mode: 'HTML'
  });

  return new Promise((resolve, reject) => {
    const buffer = Buffer.from(data);
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': buffer.length
      }
    }, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('[Telegram] Message sent successfully');
          resolve(JSON.parse(responseBody));
        } else {
          const parsed = JSON.parse(responseBody);
          const desc = parsed.description || responseBody;
          console.error('[Telegram] Failed to send message:', res.statusCode, desc);
          
          // Provide helpful error messages for common issues
          if (desc.includes('chat not found')) {
            reject(new Error(`Chat ID "${chatId}" is invalid or the bot has not been added to that chat. Make sure you started a conversation with your bot first, then use your personal Chat ID from @myidbot on Telegram.`));
          } else if (desc.includes('not found') || desc.includes('Unauthorized')) {
            reject(new Error(`Bot token appears invalid. Please check your token from @BotFather on Telegram.`));
          } else {
            reject(new Error(`Telegram API error: ${res.statusCode} - ${desc}`));
          }
        }
      });
    });

    req.on('error', (error) => {
      console.error('[Telegram] Request error:', error);
      reject(error);
    });

    req.write(buffer);
    req.end();
  });
}

function testConnection() {
  return sendMessage('✅ <b>Household Replacement Tracker</b>\n\nTest message successful! Notifications are working.');
}

function getReminderKey(itemId, dueDate, daysBefore) {
  return `reminded_${itemId}_${dueDate}_Tminus${daysBefore}`;
}

function hasSentReminder(itemId, dueDate, daysBefore) {
  const key = getReminderKey(itemId, dueDate, daysBefore);
  return !!notifiedDates[key];
}

function markReminderSent(itemId, dueDate, daysBefore) {
  const key = getReminderKey(itemId, dueDate, daysBefore);
  notifiedDates[key] = true;
  // Clean up old entries periodically (keep only last 30 days worth)
  const keys = Object.keys(notifiedDates);
  if (keys.length > 200) {
    // Keep the most recent 150 entries
    for (const key of keys.slice(0, keys.length - 150)) {
      delete notifiedDates[key];
    }
  }
}

function getDueItems() {
  const items = db.getAllItems();
  const warningDays = parseInt(db.getSettings().warning_days_before) || 7;

  const dueItems = [];
  const upcomingItems = [];

  for (const item of items) {
    if (!item.next_due_date) continue;

    const daysUntil = item.days_until_due;
    if (daysUntil === null || daysUntil === undefined) continue;

    if (daysUntil < 0) {
      // Overdue
      dueItems.push({ ...item, status: 'overdue', daysOverdue: Math.abs(daysUntil) });
    } else if (daysUntil === 0) {
      // Due today
      dueItems.push({ ...item, status: 'due_today' });
    } else if (daysUntil <= warningDays) {
      // Coming up soon
      upcomingItems.push({ ...item, status: 'upcoming' });
    }
  }

  return { dueItems, upcomingItems };
}

/**
 * Find items that match a specific reminder offset and haven't been notified yet.
 * @param {number} daysBefore - The T-minus offset (7, 2, or 0)
 * @returns {Array} Items matching this reminder window
 */
function getItemsForReminder(daysBefore) {
  const items = db.getAllItems();
  const matchingItems = [];

  for (const item of items) {
    if (!item.next_due_date) continue;

    const daysUntil = item.days_until_due;
    if (daysUntil === null || daysUntil === undefined) continue;

    // Check if this item matches the reminder offset AND we haven't sent it yet
    if (daysUntil === daysBefore && !hasSentReminder(item.id, item.next_due_date, daysBefore)) {
      matchingItems.push({ ...item });
    }
  }

  return matchingItems;
}

/**
 * Format a date for display in notifications.
 */
function formatDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

/**
 * Build a formatted message for a specific reminder type.
 */
function buildReminderMessage(items, daysBefore) {
  let message = '🏠 <b>Household Replacement Tracker</b>\n\n';

  if (daysBefore === 0) {
    // T notification: say "today" instead of due date
    message += `🔴 <b>DUE TODAY</b> — please replace soon!\n\n`;
    for (const item of items) {
      message += `• <b>${item.name}</b>\n`;
      message += `  Due: today\n`;
      if (item.category) message += `  Category: ${item.category}\n`;
      if (item.part_number) message += `  Part #: ${item.part_number}\n`;
    }
  } else if (daysBefore === 2) {
    // T-2 notification: include due date
    message += `🟡 <b>Due in 2 days</b> for the following items:\n\n`;
    for (const item of items) {
      message += `• <b>${item.name}</b>\n`;
      message += `  Due: ${formatDate(item.next_due_date)}\n`;
      if (item.category) message += `  Category: ${item.category}\n`;
      if (item.part_number) message += `  Part #: ${item.part_number}\n`;
    }
  } else if (daysBefore === 7) {
    // T-7 notification: include due date
    message += `🔵 <b>Due in 7 days</b> for the following items:\n\n`;
    for (const item of items) {
      message += `• <b>${item.name}</b>\n`;
      message += `  Due: ${formatDate(item.next_due_date)}\n`;
      if (item.category) message += `  Category: ${item.category}\n`;
      if (item.part_number) message += `  Part #: ${item.part_number}\n`;
    }
  }

  return message;
}

function sendDailyNotification() {
  if (!isEnabled || !botToken || !chatId) {
    console.log('[Telegram] Skipping daily notification: not configured');
    return;
  }

  // Send reminders for T-7, T-2, and T (due date)
  const reminderOffsets = [7, 2, 0];
  let sentCount = 0;

  const promises = [];

  for (const daysBefore of reminderOffsets) {
    const items = getItemsForReminder(daysBefore);

    if (items.length === 0) {
      console.log(`[Telegram] No items for T-${daysBefore} reminder`);
      continue;
    }

    const message = buildReminderMessage(items, daysBefore);

    // Mark all these reminders as sent before sending (to avoid race conditions)
    for (const item of items) {
      markReminderSent(item.id, item.next_due_date, daysBefore);
    }

    console.log(`[Telegram] Sending T-${daysBefore} reminder for ${items.length} item(s)`);

    const promise = sendMessage(message).then(() => {
      sentCount++;
      console.log(`[Telegram] T-${daysBefore} reminder sent successfully`);
    }).catch((error) => {
      console.error(`[Telegram] Failed to send T-${daysBefore} reminder:`, error.message);
      // If send fails, unmark so we can retry next time
      for (const item of items) {
        const key = getReminderKey(item.id, item.next_due_date, daysBefore);
        delete notifiedDates[key];
      }
    });

    promises.push(promise);
  }

  if (promises.length === 0) {
    console.log('[Telegram] No reminders to send today');
    return Promise.resolve();
  }

  return Promise.allSettled(promises).then((results) => {
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    console.log(`[Telegram] Daily notification cycle complete: ${succeeded}/${promises.length} reminders sent`);
  });
}

function getStatus() {
  return {
    isEnabled,
    isConfigured: !!(botToken && chatId),
    botTokenMasked: botToken ? `${botToken.substring(0, 5)}...${botToken.substring(botToken.length - 4)}` : null,
    chatId
  };
}

module.exports = {
  initTelegram,
  configureTelegram,
  disableTelegram,
  sendMessage,
  testConnection,
  getDueItems,
  sendDailyNotification,
  getStatus
};