const fs = require('fs');
const path = require('path');
const { Dropbox, DropboxTeam } = require('dropbox');
const initSqlJs = require('sql.js');
const db = require('./database');

// --- Configuration ---
const BACKUP_ENABLED = process.env.BACKUP_ENABLED === 'true';
const RESTORE_LATEST_BACKUP = process.env.RESTORE_LATEST_BACKUP === 'true';
const DROPBOX_REFRESH_TOKEN = process.env.BACKUP_DROPBOX_REFRESH_TOKEN || '';
const DROPBOX_FOLDER = process.env.BACKUP_DROPBOX_FOLDER || '/Backup';
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS, 10) || 30;
const BACKUP_SCHEDULE = process.env.BACKUP_SCHEDULE || '0 2 * * *';

// In-memory access token (set after refresh)
let _accessToken = null;
let _dbx = null;

/**
 * Initialize Dropbox client using the refresh token.
 * The dropbox npm package supports oauth2 with refresh tokens.
 */
async function initDropbox() {
  // Log all config values for debugging (mask token for security)
  const tokenPreview = DROPBOX_REFRESH_TOKEN ? 
    `${DROPBOX_REFRESH_TOKEN.substring(0, 8)}...${DROPBOX_REFRESH_TOKEN.substring(DROPBOX_REFRESH_TOKEN.length - 8)}` : 
    '(empty)';
  
  console.log('[Backup] === BACKUP CONFIGURATION ===');
  console.log(`[Backup] BACKUP_ENABLED: ${BACKUP_ENABLED} (raw env: "${process.env.BACKUP_ENABLED}")`);
  console.log(`[Backup] BACKUP_DROPBOX_REFRESH_TOKEN: ${tokenPreview} (length: ${DROPBOX_REFRESH_TOKEN?.length || 0})`);
  console.log(`[Backup] BACKUP_DROPBOX_FOLDER: ${DROPBOX_FOLDER}`);
  console.log(`[Backup] BACKUP_RETENTION_DAYS: ${RETENTION_DAYS}`);
  console.log(`[Backup] BACKUP_SCHEDULE: ${BACKUP_SCHEDULE}`);
  console.log('[Backup] ==============================');

  // Allow initialization when backup is enabled OR restore is requested
  if (!BACKUP_ENABLED && !RESTORE_LATEST_BACKUP) {
    console.log('[Backup] Backup is DISABLED. Set BACKUP_ENABLED=true to enable.');
    return false;
  }

  if (!DROPBOX_REFRESH_TOKEN) {
    console.log('[Backup] No Dropbox refresh token configured. Set BACKUP_DROPBOX_REFRESH_TOKEN environment variable.');
    return false;
  }

  try {
    _dbx = new Dropbox({
      accessToken: DROPBOX_REFRESH_TOKEN,
    });

    console.log('[Backup] Dropbox client created, verifying token...');

    // Verify the token works by calling users/get_current_account
    const result = await _dbx.usersGetCurrentAccount({});
    console.log(`[Backup] Dropbox authenticated as: ${result.account_name}`);
    console.log(`[Backup] Account ID: ${result.account_id}`);
    console.log(`[Backup] Email: ${result.email}`);
    return true;
  } catch (error) {
    console.error('[Backup] Failed to initialize Dropbox:', error.message);
    console.error('[Backup] Full error details:', JSON.stringify(error, null, 2));
    if (error.status) {
      console.error(`[Backup] HTTP Status: ${error.status}`);
    }
    return false;
  }
}

/**
 * Create a backup of the SQLite database.
 * Returns the local backup file path.
 */
function createLocalBackup() {
  const backupDir = path.join(__dirname, '..', 'data', 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' + 
                    new Date().toISOString().split('T')[1].replace(/:/g, '').split('.')[0];
  const backupFilename = `hrt_backup_${timestamp}.sqlite`;
  const backupPath = path.join(backupDir, backupFilename);

  try {
    // Export the database to a buffer
    const data = db.getDatabase().export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(backupPath, buffer);
    
    const size = buffer.length;
    console.log(`[Backup] Local backup created: ${backupFilename} (${formatBytes(size)})`);
    return { path: backupPath, filename: backupFilename, size };
  } catch (error) {
    console.error('[Backup] Failed to create local backup:', error.message);
    throw error;
  }
}

/**
 * Upload a backup file to Dropbox.
 */
async function uploadToDropbox(backupPath, filename) {
  if (!_dbx) {
    throw new Error('Dropbox client not initialized');
  }

  try {
    const fileBuffer = fs.readFileSync(backupPath);
    
    // Ensure folder exists by using full path
    const dropboxPath = `${DROPBOX_FOLDER}/${filename}`;
    
    const result = await _dbx.filesUpload({
      path: dropboxPath,
      mode: { '.tag': 'overwrite' },
      mute: false,
      strict_conflict: false,
      contents: fileBuffer,
    });

    console.log(`[Backup] Uploaded to Dropbox: ${result.path_display}`);
    return result;
  } catch (error) {
    console.error('[Backup] Failed to upload to Dropbox:', error.message);
    throw error;
  }
}

/**
 * Delete old backups from Dropbox beyond retention period.
 */
async function cleanupOldBackups() {
  if (!_dbx) {
    return;
  }

  try {
    // List files in the backup folder
    const listResult = await _dbx.filesListFolder({ path: DROPBOX_FOLDER });
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
    
    let deletedCount = 0;
    for (const file of listResult.entries) {
      if (file ['.tag'] !== 'file') continue;
      
      // Parse backup filename to extract date: hrt_backup_YYYY-MM-DD_HHMMSS.sqlite
      const match = file.name.match(/hrt_backup_(\d{4}-\d{2}-\d{2})_/);
      if (!match) continue;
      
      const fileDate = new Date(match[1] + 'T00:00:00');
      if (fileDate < cutoffDate) {
        await _dbx.filesDeleteV2({ path: `${DROPBOX_FOLDER}/${file.name}` });
        console.log(`[Backup] Deleted old backup: ${file.name}`);
        deletedCount++;
      }
    }
    
    if (deletedCount > 0) {
      console.log(`[Backup] Cleaned up ${deletedCount} old backup(s)`);
    }
    
    // Handle pagination if there are more files
    while (listResult.has_more) {
      const cursorResult = await _dbx.filesListFolderContinue({ 
        cursor: listResult.cursor 
      });
      
      for (const file of cursorResult.entries) {
        if (file ['.tag'] !== 'file') continue;
        
        const match = file.name.match(/hrt_backup_(\d{4}-\d{2}-\d{2})_/);
        if (!match) continue;
        
        const fileDate = new Date(match[1] + 'T00:00:00');
        if (fileDate < cutoffDate) {
          await _dbx.filesDeleteV2({ path: `${DROPBOX_FOLDER}/${file.name}` });
          console.log(`[Backup] Deleted old backup: ${file.name}`);
          deletedCount++;
        }
      }
      
      listResult = cursorResult;
    }
  } catch (error) {
    console.error('[Backup] Failed to cleanup old backups:', error.message);
  }
}

/**
 * Perform a full backup: create local, upload to Dropbox, cleanup old.
 */
async function performBackup() {
  if (!BACKUP_ENABLED) {
    console.log('[Backup] Backup is disabled.');
    return null;
  }

  try {
    console.log('[Backup] Starting daily backup...');
    
    // Step 1: Create local backup
    const localBackup = createLocalBackup();
    
    // Step 2: Upload to Dropbox
    let dropboxResult = null;
    if (_dbx) {
      dropboxResult = await uploadToDropbox(localBackup.path, localBackup.filename);
    } else {
      console.log('[Backup] Skipping Dropbox upload (not configured)');
    }
    
    // Step 3: Cleanup old backups
    if (_dbx) {
      await cleanupOldBackups();
    }
    
    // Step 4: Also cleanup local backups older than retention
    cleanupLocalBackups();
    
    console.log('[Backup] Daily backup completed successfully.');
    return {
      local: localBackup,
      dropbox: dropboxResult
    };
  } catch (error) {
    console.error('[Backup] Backup failed:', error.message);
    throw error;
  }
}

/**
 * Cleanup old local backups.
 */
function cleanupLocalBackups() {
  const backupDir = path.join(__dirname, '..', 'data', 'backups');
  if (!fs.existsSync(backupDir)) return;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

  const files = fs.readdirSync(backupDir);
  let deletedCount = 0;

  for (const file of files) {
    if (!file.startsWith('hrt_backup_') || !file.endsWith('.sqlite')) continue;
    
    const match = file.match(/hrt_backup_(\d{4}-\d{2}-\d{2})_/);
    if (!match) continue;

    const fileDate = new Date(match[1] + 'T00:00:00');
    if (fileDate < cutoffDate) {
      fs.unlinkSync(path.join(backupDir, file));
      console.log(`[Backup] Deleted old local backup: ${file}`);
      deletedCount++;
    }
  }

  if (deletedCount > 0) {
    console.log(`[Backup] Cleaned up ${deletedCount} old local backup(s)`);
  }
}

/**
 * List all available backups (local and Dropbox).
 */
async function listBackups() {
  const result = {
    local: [],
    dropbox: []
  };

  // List local backups
  const backupDir = path.join(__dirname, '..', 'data', 'backups');
  if (fs.existsSync(backupDir)) {
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('hrt_backup_') && f.endsWith('.sqlite'))
      .map(f => {
        const stat = fs.statSync(path.join(backupDir, f));
        return {
          name: f,
          size: stat.size,
          created: stat.birthtime,
          location: 'local'
        };
      })
      .sort((a, b) => new Date(b.created) - new Date(a.created));
    
    result.local = files;
  }

  // List Dropbox backups
  if (_dbx) {
    try {
      const listResult = await _dbx.filesListFolder({ path: DROPBOX_FOLDER });
      
      for (const file of listResult.entries) {
        if (file ['.tag'] === 'file' && file.name.startsWith('hrt_backup_')) {
          result.dropbox.push({
            name: file.name,
            size: file.size,
            created: file.client_modified,
            location: 'dropbox',
            path: file.path_display
          });
        }
      }

      // Handle pagination
      while (listResult.has_more) {
        const cursorResult = await _dbx.filesListFolderContinue({ 
          cursor: listResult.cursor 
        });
        
        for (const file of cursorResult.entries) {
          if (file ['.tag'] === 'file' && file.name.startsWith('hrt_backup_')) {
            result.dropbox.push({
              name: file.name,
              size: file.size,
              created: file.client_modified,
              location: 'dropbox',
              path: file.path_display
            });
          }
        }
        
        listResult = cursorResult;
      }

      result.dropbox.sort((a, b) => new Date(b.created) - new Date(a.created));
    } catch (error) {
      console.error('[Backup] Failed to list Dropbox backups:', error.message);
    }
  }

  return result;
}

/**
 * Get backup configuration status.
 */
function getStatus() {
  return {
    enabled: BACKUP_ENABLED,
    dropboxConfigured: !!_dbx,
    dropboxFolder: DROPBOX_FOLDER,
    retentionDays: RETENTION_DAYS,
    schedule: BACKUP_SCHEDULE,
  };
}

/**
 * Format bytes to human readable.
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Find the newest backup file in the Dropbox folder.
 * Returns the Dropbox file info or null if no backups found.
 */
async function findNewestDropboxBackup() {
  if (!_dbx) {
    throw new Error('Dropbox client not initialized');
  }

  try {
    console.log(`[Restore] Listing backups in ${DROPBOX_FOLDER}...`);
    const listResult = await _dbx.filesListFolder({ path: DROPBOX_FOLDER });

    let newestBackup = null;
    let newestDate = new Date(0);

    for (const file of listResult.entries) {
      if (file ['.tag'] !== 'file') continue;
      if (!file.name.startsWith('hrt_backup_') || !file.name.endsWith('.sqlite')) continue;

      const modifiedDate = file.client_modified ? new Date(file.client_modified) : 
                           file.server_modified ? new Date(file.server_modified) : new Date(0);
      
      if (modifiedDate > newestDate) {
        newestDate = modifiedDate;
        newestBackup = {
          name: file.name,
          path: file.path_display,
          size: file.size,
          modified: modifiedDate.toISOString()
        };
      }
    }

    // Handle pagination
    while (listResult.has_more) {
      const cursorResult = await _dbx.filesListFolderContinue({ 
        cursor: listResult.cursor 
      });

      for (const file of cursorResult.entries) {
        if (file ['.tag'] !== 'file') continue;
        if (!file.name.startsWith('hrt_backup_') || !file.name.endsWith('.sqlite')) continue;

        const modifiedDate = file.client_modified ? new Date(file.client_modified) : 
                             file.server_modified ? new Date(file.server_modified) : new Date(0);
        
        if (modifiedDate > newestDate) {
          newestDate = modifiedDate;
          newestBackup = {
            name: file.name,
            path: file.path_display,
            size: file.size,
            modified: modifiedDate.toISOString()
          };
        }
      }

      listResult = cursorResult;
    }

    if (!newestBackup) {
      console.log('[Restore] No backup files found in Dropbox folder.');
      return null;
    }

    console.log(`[Restore] Found newest backup: ${newestBackup.name} (${formatBytes(newestBackup.size)}, modified: ${newestBackup.modified})`);
    return newestBackup;
  } catch (error) {
    console.error('[Restore] Failed to list Dropbox backups:', error.message);
    throw error;
  }
}

/**
 * Download a backup file from Dropbox to a temporary local path.
 * Returns the local file path.
 */
async function downloadBackupFromDropbox(dropboxPath, localPath) {
  if (!_dbx) {
    throw new Error('Dropbox client not initialized');
  }

  try {
    console.log(`[Restore] Downloading ${dropboxPath} from Dropbox...`);
    const result = await _dbx.filesDownload({ path: dropboxPath });
    
    // result.file_result is a Readable stream, we need to collect all chunks
    const fileStream = result.file_result;
    const chunks = [];
    
    for await (const chunk of fileStream) {
      chunks.push(chunk);
    }
    
    const buffer = Buffer.concat(chunks);
    
    // Ensure the directory exists
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(localPath, buffer);
    console.log(`[Restore] Downloaded backup to ${localPath} (${formatBytes(buffer.length)})`);
    return localPath;
  } catch (error) {
    console.error('[Restore] Failed to download backup from Dropbox:', error.message);
    throw error;
  }
}

/**
 * Validate that a SQLite file is valid and has rows in the items table.
 * Returns { valid: true, itemCount: number } or { valid: false, reason: string }.
 */
async function validateBackupSqlite(filePath) {
  if (!fs.existsSync(filePath)) {
    return { valid: false, reason: 'Backup file does not exist' };
  }

  const fileSize = fs.statSync(filePath).size;
  if (fileSize === 0) {
    return { valid: false, reason: 'Backup file is empty' };
  }

  try {
    const SQL = await initSqlJs();
    const fileBuffer = fs.readFileSync(filePath);
    const backupDb = new SQL.Database(fileBuffer);

    // Check that the items table exists by querying sqlite_master
    const tableCheck = backupDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='items'");
    if (!tableCheck.length || !tableCheck[0].values || tableCheck[0].values.length === 0) {
      backupDb.close();
      return { valid: false, reason: 'Backup does not contain an items table' };
    }

    // Count rows in the items table
    const countResult = backupDb.exec('SELECT COUNT(*) as count FROM items');
    if (!countResult.length || !countResult[0].values || countResult[0].values.length === 0) {
      backupDb.close();
      return { valid: false, reason: 'Items table has no rows' };
    }

    const itemCount = countResult[0].values[0][0];
    backupDb.close();

    if (itemCount === 0) {
      return { valid: false, reason: `Items table exists but has ${itemCount} rows` };
    }

    console.log(`[Restore] Backup validation passed: ${itemCount} items found in items table`);
    return { valid: true, itemCount };
  } catch (error) {
    return { valid: false, reason: `Failed to parse SQLite file: ${error.message}` };
  }
}

/**
 * Restore the database from a backup file.
 * This replaces the current database file with the backup.
 */
async function restoreLatestBackup() {
  if (!RESTORE_LATEST_BACKUP) {
    console.log('[Restore] RESTORE_LATEST_BACKUP is not enabled. Skipping restore.');
    return null;
  }

  console.log('========================================');
  console.log('[Restore] RESTORE_LATEST_BACKUP is ENABLED');
  console.log('[Restore] Starting restore process...');
  console.log('========================================');

  // Step 1: Initialize Dropbox first
  const initialized = await initDropbox();
  if (!initialized) {
    console.error('[Restore] Cannot restore: Dropbox client failed to initialize.');
    throw new Error('Dropbox client not available for restore');
  }

  // Step 2: Find the newest backup
  const newestBackup = await findNewestDropboxBackup();
  if (!newestBackup) {
    console.error('[Restore] Cannot restore: No backups found in Dropbox.');
    throw new Error('No backups available to restore');
  }

  // Step 3: Download the backup to a temporary location
  const tempBackupPath = path.join(__dirname, '..', 'data', 'backups', '_restore_temp.sqlite');
  await downloadBackupFromDropbox(newestBackup.path, tempBackupPath);

  try {
    // Step 4: Validate the downloaded backup
    console.log('[Restore] Validating backup file...');
    const validation = await validateBackupSqlite(tempBackupPath);
    
    if (!validation.valid) {
      console.error(`[Restore] Backup validation FAILED: ${validation.reason}`);
      // Clean up temp file
      fs.unlinkSync(tempBackupPath);
      throw new Error(`Backup validation failed: ${validation.reason}`);
    }

    // Step 5: Create a safety backup of the current database before overwriting
    const DB_PATH = path.join(__dirname, '..', 'data', 'hrt.db');
    if (fs.existsSync(DB_PATH)) {
      const safetyBackupName = `hrt_pre_restore_${new Date().toISOString().replace(/[:.]/g, '-').split('T')[0]}_${new Date().toISOString().split('T')[1].replace(/:/g, '').split('.')[0]}.sqlite`;
      const safetyBackupPath = path.join(__dirname, '..', 'data', 'backups', safetyBackupName);
      fs.copyFileSync(DB_PATH, safetyBackupPath);
      console.log(`[Restore] Created safety backup of current database: ${safetyBackupName}`);
    }

    // Step 6: Replace the current database with the validated backup
    console.log('[Restore] Restoring database from backup...');
    fs.copyFileSync(tempBackupPath, DB_PATH);
    console.log(`[Restore] Database restored successfully! (${validation.itemCount} items)`);

    // Clean up temp file
    fs.unlinkSync(tempBackupPath);

    return {
      source: newestBackup.name,
      sourcePath: newestBackup.path,
      itemCount: validation.itemCount,
      size: newestBackup.size,
      modified: newestBackup.modified
    };
  } catch (error) {
    // Clean up temp file on error
    if (fs.existsSync(tempBackupPath)) {
      fs.unlinkSync(tempBackupPath);
    }
    throw error;
  }
}

module.exports = {
  initDropbox,
  performBackup,
  listBackups,
  getStatus,
  createLocalBackup,
  restoreLatestBackup,
  findNewestDropboxBackup,
  downloadBackupFromDropbox,
  validateBackupSqlite,
};
