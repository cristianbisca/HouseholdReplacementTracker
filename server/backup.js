const fs = require('fs');
const path = require('path');
const { Dropbox, DropboxTeam } = require('dropbox');
const db = require('./database');

// --- Configuration ---
const BACKUP_ENABLED = process.env.BACKUP_ENABLED === 'true';
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

  if (!BACKUP_ENABLED) {
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

module.exports = {
  initDropbox,
  performBackup,
  listBackups,
  getStatus,
  createLocalBackup,
};