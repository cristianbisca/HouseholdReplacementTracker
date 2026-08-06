const BUILD_TIMESTAMP = '2026-07-29T18:18:00Z';

const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { execSync } = require('child_process');
const WebSocket = require('ws');
const path = require('path');
const cron = require('node-cron');
const db = require('./database');
const telegram = require('./telegram');
const auth = require('./auth');
const backup = require('./backup');

const app = express();

// --- TLS/HTTPS Configuration ---
// Controlled by TLS_MODE env var: 'auto' (default) or 'off'
// Certs are stored in /app/certs inside the container.
// If certs don't exist and TLS_MODE=auto, self-signed certs are generated at startup.
const CERTS_DIR = path.join(__dirname, '..', 'certs');
const CERT_PATH = process.env.TLS_CERT || path.join(CERTS_DIR, 'cert.pem');
const KEY_PATH  = process.env.TLS_KEY  || path.join(CERTS_DIR, 'key.pem');
const TLS_MODE  = (process.env.TLS_MODE || 'auto').toLowerCase();

let tlsActive = false;
let server;

if (TLS_MODE === 'off') {
  // Explicitly HTTP-only
  server = http.createServer(app);
  console.log('[TLS] HTTPS disabled (TLS_MODE=off)');
} else if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
  // Use existing certificates
  const tlsOptions = {
    key: fs.readFileSync(KEY_PATH),
    cert: fs.readFileSync(CERT_PATH),
  };
  server = https.createServer(tlsOptions, app);
  tlsActive = true;
  console.log('[TLS] HTTPS enabled (existing certificates)');
} else {
  // Auto-generate self-signed certificate at startup
  try {
    const os = require('os');

    // Determine CN: use env var or first LAN IPv4
    let cn = process.env.TLS_CN || 'localhost';
    if (!process.env.TLS_CN) {
      const ifaces = os.networkInterfaces();
      for (const [name, list] of Object.entries(ifaces)) {
        for (const iface of list) {
          if (iface.family === 'IPv4' && !iface.internal) {
            cn = iface.address;
            break;
          }
        }
        if (cn !== 'localhost') break;
      }
    }

    // Ensure certs directory exists
    if (!fs.existsSync(CERTS_DIR)) {
      fs.mkdirSync(CERTS_DIR, { recursive: true });
    }

    // Generate self-signed cert with SAN using openssl
    execSync(
      `openssl req -x509 -newkey rsa:2048 -nodes -days 3650 ` +
      `-subj "/CN=${cn}" ` +
      `-addext "subjectAltName=DNS:${cn},IP:${cn},DNS:localhost,IP:127.0.0.1" ` +
      `-out "${CERT_PATH}" -keyout "${KEY_PATH}"`,
      { timeout: 15000 }
    );

    const tlsOptions = {
      key: fs.readFileSync(KEY_PATH),
      cert: fs.readFileSync(CERT_PATH),
    };
    server = https.createServer(tlsOptions, app);
    tlsActive = true;
    console.log(`[TLS] HTTPS enabled (self-signed cert generated for ${cn})`);

  } catch (err) {
    console.error('[TLS] Could not generate certificate:', err.message);
    server = http.createServer(app);
    console.log('[TLS] Running in HTTP mode');
  }
}

const wss = new WebSocket.Server({ server });

// --- Middleware ---
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res, filePath) => {
    // No-cache for all assets to prevent stale files after updates
    if (/\.js$|\.css$|\.html$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// --- CORS Headers (for local network access) ---
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// --- WebSocket Connection Management ---
const clients = new Map();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const user = url.searchParams.get('user') || 'anonymous';
  const clientId = `${user}-${Date.now()}`;

  clients.set(clientId, { ws, user });
  console.log(`Client connected: ${clientId} (${user})`);

  // Send current state on connect
  ws.send(JSON.stringify({
    type: 'state_update',
    payload: { items: db.getAllItems() }
  }));

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      console.log(`Message from ${clientId}:`, message.type);
      
      switch (message.type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        default:
          console.log('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
    }
  });

  ws.on('close', () => {
    clients.delete(clientId);
    console.log(`Client disconnected: ${clientId}`);
    
    broadcast({
      type: 'client_disconnected',
      payload: { clientId, user }
    }, clientId);
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for ${clientId}:`, error);
    clients.delete(clientId);
  });
});

function broadcast(message, excludeClientId = null) {
  const data = JSON.stringify(message);
  
  for (const [clientId, client] of clients) {
    if (clientId !== excludeClientId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
    }
  }
}

// --- Auth Routes (public) ---

// Login
app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password required' });
    }

    const token = auth.login(username, password);
    if (!token) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    res.json({ success: true, data: { token } });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');

    auth.logout(token);
    res.json({ success: true });
  } catch (error) {
    console.error('Error during logout:', error);
    res.status(500).json({ success: false, error: 'Logout failed' });
  }
});

// Verify current session
app.get('/api/auth/verify', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');

  const session = auth.validateToken(token);
  res.json({ success: !!session });
});

// --- API Routes (protected) ---

// Get all items
app.get('/api/items', auth.requireAuth, (req, res) => {
  try {
    const items = db.getAllItems();
    res.json({ success: true, data: items });
  } catch (error) {
    console.error('Error getting items:', error);
    res.status(500).json({ success: false, error: 'Failed to get items' });
  }
});

// Get single item
app.get('/api/items/:id', auth.requireAuth, (req, res) => {
  try {
    const item = db.getItemById(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }
    res.json({ success: true, data: item });
  } catch (error) {
    console.error('Error getting item:', error);
    res.status(500).json({ success: false, error: 'Failed to get item' });
  }
});

// Create new item
app.post('/api/items', auth.requireAuth, (req, res) => {
  try {
    const item = db.createItem(req.body);
    
    broadcast({
      type: 'item_created',
      payload: { item }
    });

    res.status(201).json({ success: true, data: item });
  } catch (error) {
    console.error('Error creating item:', error);
    res.status(500).json({ success: false, error: 'Failed to create item' });
  }
});

// Update item
app.put('/api/items/:id', auth.requireAuth, (req, res) => {
  try {
    const item = db.updateItem(req.params.id, req.body);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    broadcast({
      type: 'item_updated',
      payload: { item }
    });

    res.json({ success: true, data: item });
  } catch (error) {
    console.error('Error updating item:', error);
    res.status(500).json({ success: false, error: 'Failed to update item' });
  }
});

// Delete item
app.delete('/api/items/:id', auth.requireAuth, (req, res) => {
  try {
    const item = db.getItemById(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    db.deleteItem(req.params.id);

    broadcast({
      type: 'item_deleted',
      payload: { id: req.params.id, name: item.name }
    });

    res.json({ success: true, data: { id: req.params.id } });
  } catch (error) {
    console.error('Error deleting item:', error);
    res.status(500).json({ success: false, error: 'Failed to delete item' });
  }
});

// Record replacement (One-Tap Reset)
app.post('/api/items/:id/replace', auth.requireAuth, (req, res) => {
  try {
    const { notes, replaced_by } = req.body;
    
    const updatedItem = db.recordReplacement(req.params.id, replaced_by);
    if (!updatedItem) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    broadcast({
      type: 'replacement_recorded',
      payload: { item: updatedItem, notes, replaced_by }
    });

    res.json({ success: true, data: updatedItem });
  } catch (error) {
    console.error('Error recording replacement:', error);
    res.status(500).json({ success: false, error: 'Failed to record replacement' });
  }
});

// Increment usage counter
app.post('/api/items/:id/usage', auth.requireAuth, (req, res) => {
  try {
    const { amount } = req.body;
    
    if (!amount || amount < 1) {
      return res.status(400).json({ success: false, error: 'Invalid amount' });
    }

    const updatedItem = db.incrementUsage(req.params.id, amount);
    if (!updatedItem) {
      return res.status(404).json({ success: false, error: 'Item not found or usage not enabled' });
    }

    broadcast({
      type: 'usage_incremented',
      payload: { item: updatedItem, amount }
    });

    res.json({ success: true, data: updatedItem });
  } catch (error) {
    console.error('Error incrementing usage:', error);
    res.status(500).json({ success: false, error: 'Failed to increment usage' });
  }
});

// Get replacement history for an item
app.get('/api/items/:id/history', auth.requireAuth, (req, res) => {
  try {
    const history = db.getReplacementHistory(req.params.id);
    res.json({ success: true, data: history });
  } catch (error) {
    console.error('Error getting history:', error);
    res.status(500).json({ success: false, error: 'Failed to get history' });
  }
});

// Get settings
app.get('/api/settings', auth.requireAuth, (req, res) => {
  try {
    const settings = db.getSettings();
    res.json({ success: true, data: settings });
  } catch (error) {
    console.error('Error getting settings:', error);
    res.status(500).json({ success: false, error: 'Failed to get settings' });
  }
});

// Update setting
app.put('/api/settings/:key', auth.requireAuth, (req, res) => {
  try {
    db.updateSetting(req.params.key, req.body.value);
    const settings = db.getSettings();
    res.json({ success: true, data: settings });
  } catch (error) {
    console.error('Error updating setting:', error);
    res.status(500).json({ success: false, error: 'Failed to update setting' });
  }
});

// Health check
app.get('/api/version', (req, res) => {
  res.json({ success: true, buildTimestamp: BUILD_TIMESTAMP });
});

app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    data: { 
      status: 'ok', 
      clients: clients.size,
      uptime: process.uptime() 
    } 
  });
});

// --- Telegram API Routes ---

// Get Telegram status
app.get('/api/telegram/status', (req, res) => {
  try {
    const status = telegram.getStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    console.error('Error getting Telegram status:', error);
    res.status(500).json({ success: false, error: 'Failed to get Telegram status' });
  }
});

// Configure Telegram bot
app.post('/api/telegram/configure', auth.requireAuth, (req, res) => {
  try {
    const { bot_token, chat_id } = req.body;
    
    if (!bot_token || !chat_id) {
      return res.status(400).json({ success: false, error: 'bot_token and chat_id are required' });
    }

    telegram.configureTelegram(bot_token, chat_id);
    res.json({ success: true, data: telegram.getStatus() });
  } catch (error) {
    console.error('Error configuring Telegram:', error);
    res.status(500).json({ success: false, error: 'Failed to configure Telegram' });
  }
});

// Disable Telegram notifications
app.post('/api/telegram/disable', auth.requireAuth, (req, res) => {
  try {
    telegram.disableTelegram();
    res.json({ success: true, data: telegram.getStatus() });
  } catch (error) {
    console.error('Error disabling Telegram:', error);
    res.status(500).json({ success: false, error: 'Failed to disable Telegram' });
  }
});

// Test Telegram connection
app.post('/api/telegram/test', auth.requireAuth, (req, res) => {
  telegram.testConnection()
    .then((result) => {
      res.json({ success: true, data: result });
    })
    .catch((error) => {
      res.status(500).json({ success: false, error: error.message });
    });
});

// Get due items report
app.get('/api/telegram/due-items', auth.requireAuth, (req, res) => {
  try {
    const report = telegram.getDueItems();
    res.json({ success: true, data: report });
  } catch (error) {
    console.error('Error getting due items:', error);
    res.status(500).json({ success: false, error: 'Failed to get due items' });
  }
});

// Manual trigger notification
app.post('/api/telegram/notify', auth.requireAuth, (req, res) => {
  telegram.sendDailyNotification()
    .then((result) => {
      res.json({ success: true, data: result });
    })
    .catch((error) => {
      if (error.message.includes('not configured')) {
        res.status(400).json({ success: false, error: error.message });
      } else {
        res.status(500).json({ success: false, error: error.message });
      }
    });
});

// --- Backup API Routes ---

// Get backup status
app.get('/api/backup/status', auth.requireAuth, (req, res) => {
  try {
    const status = backup.getStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    console.error('Error getting backup status:', error);
    res.status(500).json({ success: false, error: 'Failed to get backup status' });
  }
});

// Trigger manual backup
app.post('/api/backup/run', auth.requireAuth, (req, res) => {
  backup.performBackup()
    .then((result) => {
      res.json({ success: true, data: result });
    })
    .catch((error) => {
      res.status(500).json({ success: false, error: error.message });
    });
});

// List all backups
app.get('/api/backup/list', auth.requireAuth, (req, res) => {
  backup.listBackups()
    .then((result) => {
      res.json({ success: true, data: result });
    })
    .catch((error) => {
      res.status(500).json({ success: false, error: error.message });
    });
});

// Serve index.html for all non-API routes (SPA fallback)
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  } else {
    res.status(404).json({ success: false, error: 'API endpoint not found' });
  }
});

// --- Server Startup ---
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Initialize auth
    auth.initAuth();

    // Initialize database
    await db.initDatabase();
    console.log('Database initialized successfully');

    // Initialize Telegram bot
    telegram.initTelegram();

    // Initialize Dropbox backup
    await backup.initDropbox();

    // Start server (HTTP or HTTPS)
    const protocol = tlsActive ? 'https' : 'http';
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`\n========================================`);
      console.log(` Household Replacement Tracker Server`);
      console.log(`========================================`);
      console.log(` BUILD TIMESTAMP: ${BUILD_TIMESTAMP}`);
      console.log(` Server started at: ${new Date().toISOString()}`);
      console.log(` Listening on port ${PORT} (${protocol.toUpperCase()})`);
      console.log(`========================================\n`);
      
      // Get network interfaces for local network access
      const os = require('os');
      const networks = os.networkInterfaces();
      
      for (const [name, interfaces] of Object.entries(networks)) {
        for (const iface of interfaces) {
          if (iface.family === 'IPv4' && !iface.internal) {
            console.log(`Network: ${protocol}://${iface.address}:${PORT}`);
          }
        }
      }
      
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    });

    // Periodic database save every 30 seconds
    setInterval(() => {
      db.saveDatabase();
    }, 30000);

    // Determine timezone: use env var or default to Europe/Bucharest
    const tz = process.env.NOTIFICATION_TIMEZONE || 'Europe/Bucharest';

    // Daily Telegram notification at 8:00 AM in local timezone
    // node-cron v4.x: schedule(pattern, callback, options)
    cron.schedule('0 8 * * *', () => {
      console.log(`[Cron] Running daily Telegram notification check (${tz})...`);
      telegram.sendDailyNotification();
    }, { timezone: tz });
    console.log(`[Cron] Daily notification scheduler started (runs at 8:00 AM ${tz})`);

    // Daily backup at configured time (default 2:00 AM)
    const backupSchedule = process.env.BACKUP_SCHEDULE || '0 2 * * *';
    cron.schedule(backupSchedule, () => {
      console.log(`[Cron] Running scheduled backup (${tz})...`);
      backup.performBackup().catch(err => {
        console.error('[Cron] Backup failed:', err.message);
      });
    }, { timezone: tz });
    console.log(`[Cron] Backup scheduler started (runs at ${backupSchedule} ${tz})`);

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  db.saveDatabase();
  
  for (const client of clients.values()) {
    client.ws.close();
  }
  
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\nTerminating...');
  db.saveDatabase();
  server.close(() => process.exit(0));
});

startServer();