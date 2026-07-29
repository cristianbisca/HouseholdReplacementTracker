const https = require('https');
const db = require('./database');

let botToken = null;
let chatId = null;
let isEnabled = false;
let notifiedDates = {}; // Track what we've already notified to avoid spam

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
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
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

    req.write(data);
    req.end();
  });
}

function testConnection() {
  return sendMessage('✅ <b>Household Replacement Tracker</b>\n\nTest message successful! Notifications are working.');
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

function sendDailyNotification() {
  if (!isEnabled || !botToken || !chatId) {
    console.log('[Telegram] Skipping daily notification: not configured');
    return;
  }

  const { dueItems, upcomingItems } = getDueItems();

  // Nothing to report
  if (dueItems.length === 0 && upcomingItems.length === 0) {
    return;
  }

  let message = '🏠 <b>Household Replacement Tracker</b>\n\n';

  const today = new Date().toISOString().split('T')[0];

  // Build a key for today's notifications to avoid duplicate sends
  const notifiedKey = `last_sent_${today}`;
  
  if (notifiedDates[notifiedKey]) {
    console.log('[Telegram] Already sent notification for today, skipping');
    return;
  }

  // Overdue items
  const overdueItems = dueItems.filter(i => i.status === 'overdue');
  const dueTodayItems = dueItems.filter(i => i.status === 'due_today');

  if (overdueItems.length > 0) {
    message += `🔴 <b>OVERDUE</b>\n`;
    for (const item of overdueItems) {
      message += `• <b>${item.name}</b> - ${item.daysOverdue} day(s) overdue\n`;
    }
    message += '\n';
  }

  if (dueTodayItems.length > 0) {
    message += `🟡 <b>DUE TODAY</b>\n`;
    for (const item of dueTodayItems) {
      message += `• <b>${item.name}</b>\n`;
    }
    message += '\n';
  }

  if (upcomingItems.length > 0) {
    message += `🔵 <b>COMING UP SOON</b>\n`;
    for (const item of upcomingItems) {
      const daysText = item.days_until_due === 1 ? '1 day' : `${item.days_until_due} days`;
      message += `• <b>${item.name}</b> - in ${daysText}\n`;
    }
  }

  // Clear notified state since we're building a new message
  // Set after successful send
  return sendMessage(message).then(() => {
    notifiedDates[notifiedKey] = true;
    // Clean up old entries (keep only last 7 days)
    const keys = Object.keys(notifiedDates);
    if (keys.length > 7) {
      for (const key of keys.slice(0, -7)) {
        delete notifiedDates[key];
      }
    }
    console.log('[Telegram] Daily notification sent');
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