const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- Middleware ---
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

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

// --- API Routes ---

// Get all items
app.get('/api/items', (req, res) => {
  try {
    const items = db.getAllItems();
    res.json({ success: true, data: items });
  } catch (error) {
    console.error('Error getting items:', error);
    res.status(500).json({ success: false, error: 'Failed to get items' });
  }
});

// Get single item
app.get('/api/items/:id', (req, res) => {
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
app.post('/api/items', (req, res) => {
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
app.put('/api/items/:id', (req, res) => {
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
app.delete('/api/items/:id', (req, res) => {
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
app.post('/api/items/:id/replace', (req, res) => {
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
app.post('/api/items/:id/usage', (req, res) => {
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
app.get('/api/items/:id/history', (req, res) => {
  try {
    const history = db.getReplacementHistory(req.params.id);
    res.json({ success: true, data: history });
  } catch (error) {
    console.error('Error getting history:', error);
    res.status(500).json({ success: false, error: 'Failed to get history' });
  }
});

// Get settings
app.get('/api/settings', (req, res) => {
  try {
    const settings = db.getSettings();
    res.json({ success: true, data: settings });
  } catch (error) {
    console.error('Error getting settings:', error);
    res.status(500).json({ success: false, error: 'Failed to get settings' });
  }
});

// Update setting
app.put('/api/settings/:key', (req, res) => {
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

// Serve index.html for all non-API routes (SPA fallback)
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  } else {
    res.status(404).json({ success: false, error: 'API endpoint not found' });
  }
});

// --- Server Startup ---
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Initialize database
    await db.initDatabase();
    console.log('Database initialized successfully');

    // Start HTTP server
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`\n🏠 Household Replacement Tracker`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`Server running on port ${PORT}`);
      console.log(`Local:   http://localhost:${PORT}`);
      
      // Get network interfaces for local network access
      const os = require('os');
      const networks = os.networkInterfaces();
      
      for (const [name, interfaces] of Object.entries(networks)) {
        for (const iface of interfaces) {
          if (iface.family === 'IPv4' && !iface.internal) {
            console.log(`Network: http://${iface.address}:${PORT}`);
          }
        }
      }
      
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    });

    // Periodic database save every 30 seconds
    setInterval(() => {
      db.saveDatabase();
    }, 30000);

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