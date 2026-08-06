const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

let SQL;
let db;

const DB_PATH = path.join(__dirname, '..', 'data', 'hrt.db');

async function initDatabase() {
  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  SQL = await initSqlJs();

  // Load existing database or create new one
  let existingDb = null;
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    existingDb = new SQL.Database(fileBuffer);
  } else {
    existingDb = new SQL.Database();
  }

  db = existingDb;

  // Enable WAL mode and foreign keys
  db.run('PRAGMA journal_mode = WAL;');
  db.run('PRAGMA foreign_keys = ON;');

  createTables();
  initSettings();
  saveDatabase();

  return db;
}

function createTables() {
  // Items table - main tracking entries
  db.run(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT DEFAULT '',
      description TEXT DEFAULT '',
      
      -- Time-based tracking
      time_interval_type TEXT DEFAULT 'months',
      time_interval_value INTEGER DEFAULT 6,
      last_replaced_date TEXT,
      next_due_date TEXT,
      is_overdue INTEGER DEFAULT 0,
      days_until_due INTEGER,
      
      -- Usage/counter-based tracking
      usage_enabled INTEGER DEFAULT 0,
      usage_interval_value INTEGER DEFAULT 0,
      usage_unit TEXT DEFAULT 'units',
      current_usage_count REAL DEFAULT 0,
      last_reset_date TEXT,
      usage_percentage REAL DEFAULT 0,
      
      -- Part & order info
      part_number TEXT DEFAULT '',
      manufacturer TEXT DEFAULT '',
      specifications TEXT DEFAULT '',
      reorder_url TEXT DEFAULT '',
      
      -- Notes
      notes TEXT DEFAULT '',
      
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Replacement history table
  db.run(`
    CREATE TABLE IF NOT EXISTS replacement_history (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      replaced_date TEXT NOT NULL,
      notes TEXT DEFAULT '',
      replaced_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    )
  `);

  // Settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Create indexes for performance
  db.run('CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);');
  db.run('CREATE INDEX IF NOT EXISTS idx_items_next_due ON items(next_due_date);');
  db.run('CREATE INDEX IF NOT EXISTS idx_history_item_id ON replacement_history(item_id);');
}

function initSettings() {
  const settings = [
    { key: 'app_name', value: 'Household Replacement Tracker' },
    { key: 'default_time_interval_value', value: '6' },
    { key: 'default_time_interval_type', value: 'months' },
    { key: 'warning_days_before', value: '7' }
  ];

  for (const setting of settings) {
    const result = db.exec(`SELECT * FROM settings WHERE key = '${setting.key}'`);
    if (!result.length || result[0].values.length === 0) {
      db.run(`INSERT INTO settings (key, value) VALUES ('${setting.key}', '${setting.value}')`);
    }
  }
}

function saveDatabase() {
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (error) {
    console.error('Failed to save database:', error);
  }
}

// --- Query Functions ---

function getAllItems() {
  const result = db.exec('SELECT * FROM items ORDER BY name ASC');
  if (!result.length || !result[0].values) return [];

  return result[0].values.map(row => {
    const cols = result[0].columns;
    const item = {};
    cols.forEach((col, i) => {
      item[col] = row[i];
    });
    // Convert boolean-like integers
    item.usage_enabled = !!item.usage_enabled;
    item.is_overdue = !!item.is_overdue;
    // Recalculate days_until_due and is_overdue on every load to ensure freshness
    if (item.next_due_date) {
      item.days_until_due = calculateDaysUntilDue(item.next_due_date);
      item.is_overdue = item.days_until_due < 0;
    } else {
      item.days_until_due = null;
      item.is_overdue = false;
    }
    // Recalculate usage_percentage for usage-based items
    if (item.usage_enabled && item.usage_interval_value) {
      item.usage_percentage = calculateUsagePercentage(item.current_usage_count || 0, item.usage_interval_value);
    }
    return item;
  });
}

function getItemById(id) {
  const result = db.exec(`SELECT * FROM items WHERE id = '${id}'`);
  if (!result.length || !result[0].values || result[0].values.length === 0) return null;

  const row = result[0].values[0];
  const cols = result[0].columns;
  const item = {};
  cols.forEach((col, i) => {
    item[col] = row[i];
  });
  item.usage_enabled = !!item.usage_enabled;
  item.is_overdue = !!item.is_overdue;
  // Recalculate days_until_due and is_overdue to ensure freshness
  if (item.next_due_date) {
    item.days_until_due = calculateDaysUntilDue(item.next_due_date);
    item.is_overdue = item.days_until_due < 0;
  } else {
    item.days_until_due = null;
    item.is_overdue = false;
  }
  // Recalculate usage_percentage for usage-based items
  if (item.usage_enabled && item.usage_interval_value) {
    item.usage_percentage = calculateUsagePercentage(item.current_usage_count || 0, item.usage_interval_value);
  }
  return item;
}

function createItem(item) {
  const { v1: uuidv4 } = require('uuid');
  const id = uuidv4();

  // Determine next_due_date: use manual input if provided, otherwise calculate from last_replaced_date + interval
  let nextDueDate = item.next_due_date || null;
  if (!nextDueDate && item.last_replaced_date && item.time_interval_value) {
    nextDueDate = calculateNextDueDate(item.last_replaced_date, item.time_interval_value, item.time_interval_type || 'months');
  }

  db.run(`
    INSERT INTO items (
      id, name, category, description,
      time_interval_type, time_interval_value,
      last_replaced_date, next_due_date,
      usage_enabled, usage_interval_value, usage_unit, current_usage_count,
      part_number, manufacturer, specifications, reorder_url, notes
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `, [
    id,
    item.name,
    item.category || '',
    item.description || '',
    item.time_interval_type || 'months',
    item.time_interval_value || 6,
    item.last_replaced_date || null,
    nextDueDate,
    item.usage_enabled ? 1 : 0,
    item.usage_interval_value || 0,
    item.usage_unit || 'units',
    item.current_usage_count || 0,
    item.part_number || '',
    item.manufacturer || '',
    item.specifications || '',
    item.reorder_url || '',
    item.notes || ''
  ]);

  saveDatabase();
  return getItemById(id);
}

function updateItem(id, updates) {
  const sets = [];
  const values = [];

  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.category !== undefined) { sets.push('category = ?'); values.push(updates.category); }
  if (updates.description !== undefined) { sets.push('description = ?'); values.push(updates.description); }
  if (updates.time_interval_type !== undefined) { sets.push('time_interval_type = ?'); values.push(updates.time_interval_type); }
  if (updates.time_interval_value !== undefined) { sets.push('time_interval_value = ?'); values.push(updates.time_interval_value); }
  if (updates.last_replaced_date !== undefined) { sets.push('last_replaced_date = ?'); values.push(updates.last_replaced_date); }
  if (updates.next_due_date !== undefined) { sets.push('next_due_date = ?'); values.push(updates.next_due_date); }
  if (updates.usage_enabled !== undefined) { sets.push('usage_enabled = ?'); values.push(updates.usage_enabled ? 1 : 0); }
  if (updates.usage_interval_value !== undefined) { sets.push('usage_interval_value = ?'); values.push(updates.usage_interval_value); }
  if (updates.usage_unit !== undefined) { sets.push('usage_unit = ?'); values.push(updates.usage_unit); }
  if (updates.current_usage_count !== undefined) { sets.push('current_usage_count = ?'); values.push(updates.current_usage_count); }
  if (updates.part_number !== undefined) { sets.push('part_number = ?'); values.push(updates.part_number); }
  if (updates.manufacturer !== undefined) { sets.push('manufacturer = ?'); values.push(updates.manufacturer); }
  if (updates.specifications !== undefined) { sets.push('specifications = ?'); values.push(updates.specifications); }
  if (updates.reorder_url !== undefined) { sets.push('reorder_url = ?'); values.push(updates.reorder_url); }
  if (updates.notes !== undefined) { sets.push('notes = ?'); values.push(updates.notes); }

  // Always update updated_at
  sets.push("updated_at = datetime('now')");

  if (sets.length <= 1) return getItemById(id); // Nothing to update

  values.push(id);
  db.run(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`, values);

  saveDatabase();
  return getItemById(id);
}

function deleteItem(id) {
  db.run('DELETE FROM replacement_history WHERE item_id = ?', [id]);
  db.run('DELETE FROM items WHERE id = ?', [id]);
  saveDatabase();
}

function addReplacementHistory(itemId, replacedDate, notes, replacedBy) {
  const { v1: uuidv4 } = require('uuid');
  const id = uuidv4();

  db.run(`
    INSERT INTO replacement_history (id, item_id, replaced_date, notes, replaced_by)
    VALUES (?, ?, ?, ?, ?)
  `, [id, itemId, replacedDate, notes || '', replacedBy || '']);

  saveDatabase();
}

function getReplacementHistory(itemId) {
  const result = db.exec(`
    SELECT * FROM replacement_history 
    WHERE item_id = '${itemId}' 
    ORDER BY replaced_date DESC
  `);
  
  if (!result.length || !result[0].values) return [];

  return result[0].values.map(row => {
    const cols = result[0].columns;
    const entry = {};
    cols.forEach((col, i) => {
      entry[col] = row[i];
    });
    return entry;
  });
}

function getSettings() {
  const result = db.exec('SELECT * FROM settings');
  if (!result.length || !result[0].values) return {};

  const settings = {};
  result[0].values.forEach(row => {
    settings[row[0]] = row[1];
  });
  return settings; }

function updateSetting(key, value) {
  db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, String(value)]);
  saveDatabase();
}

// --- Date Calculation Helpers ---
function calculateNextDueDate(lastReplacedDate, intervalValue, intervalType) {
  if (!lastReplacedDate) return null;

  const date = new Date(lastReplacedDate + 'T00:00:00');
  
  switch (intervalType) {
    case 'days':
      date.setDate(date.getDate() + intervalValue);
      break;
    case 'weeks':
      date.setDate(date.getDate() + (intervalValue * 7));
      break;
    case 'months':
      date.setMonth(date.getMonth() + intervalValue);
      break;
    case 'years':
      date.setFullYear(date.getFullYear() + intervalValue);
      break;
  }

  return date.toISOString().split('T')[0];
}

function calculateDaysUntilDue(nextDueDate) {
  if (!nextDueDate) return null;

  // Use Europe/Bucharest timezone (or env override) for "today" calculation
  const tz = process.env.NOTIFICATION_TIMEZONE || 'Europe/Bucharest';

  // Get current date components in the target timezone
  const now = new Date();
  const tzDateStr = now.toLocaleDateString('en-CA', { timeZone: tz }); // produces YYYY-MM-DD
  const [todayYear, todayMonth, todayDay] = tzDateStr.split('-').map(Number);

  // Today at midnight UTC (derived from target timezone date)
  const todayMidnight = Date.UTC(todayYear, todayMonth - 1, todayDay);

  // Due date at midnight UTC
  const [dueYear, dueMonth, dueDay] = nextDueDate.split('-').map(Number);
  const dueMidnight = Date.UTC(dueYear, dueMonth - 1, dueDay);

  const diffMs = dueMidnight - todayMidnight;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function calculateUsagePercentage(currentCount, intervalValue) {
  if (!intervalValue || intervalValue === 0) return 0;
  return Math.min(100, (currentCount / intervalValue) * 100);
}

// --- Record Replacement Logic ---
function recordReplacement(itemId, replacedBy) {
  const item = getItemById(itemId);
  if (!item) return null;

  const today = new Date().toISOString().split('T')[0];

  // Add to history
  addReplacementHistory(itemId, today, '', replacedBy || '');

  // Calculate next due date based on interval
  const nextDue = calculateNextDueDate(today, item.time_interval_value, item.time_interval_type);
  const daysUntil = nextDue ? calculateDaysUntilDue(nextDue) : null;
  const isOverdue = daysUntil !== null && daysUntil < 0;

  // Reset usage counter if enabled
  let resetSets = {
    last_replaced_date: today,
    next_due_date: nextDue,
    days_until_due: daysUntil,
    is_overdue: isOverdue ? 1 : 0
  };

  if (item.usage_enabled && item.usage_interval_value) {
    resetSets.current_usage_count = 0;
    resetSets.last_reset_date = today;
    resetSets.usage_percentage = 0;
  }

  updateItem(itemId, resetSets);
  return getItemById(itemId);
}

// --- Increment Usage Logic ---
function incrementUsage(itemId, amount) {
  const item = getItemById(itemId);
  if (!item || !item.usage_enabled) return null;

  const newCount = (item.current_usage_count || 0) + amount;
  const percentage = calculateUsagePercentage(newCount, item.usage_interval_value);

  // Auto-reset if exceeded
  let finalCount = newCount;
  let resetDate = item.last_reset_date;

  if (newCount >= item.usage_interval_value) {
    finalCount = newCount - item.usage_interval_value;
    const today = new Date().toISOString().split('T')[0];
    resetDate = today;
    
    // Also add to history for the reset
    addReplacementHistory(itemId, today, `Auto-reset at ${item.usage_interval_value} ${item.usage_unit}`, '');
  }

  updateItem(itemId, {
    current_usage_count: finalCount,
    usage_percentage: calculateUsagePercentage(finalCount, item.usage_interval_value),
    last_reset_date: resetDate || item.last_reset_date
  });

  return getItemById(itemId);
}

module.exports = {
  initDatabase,
  getAllItems,
  getItemById,
  createItem,
  updateItem,
  deleteItem,
  addReplacementHistory,
  getReplacementHistory,
  getSettings,
  updateSetting,
  recordReplacement,
  incrementUsage,
  calculateNextDueDate,
  saveDatabase,
  getDatabase
};
