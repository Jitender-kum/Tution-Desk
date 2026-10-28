'use strict';

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

/**
 * Safely migrates an existing LocalAuth directory (./.wwebjs_auth/session-${centerId})
 * into MongoDB GridFS RemoteAuth format if not already migrated.
 *
 * Preserves the original LocalAuth directory untouched.
 */
async function migrateLocalSessionToRemote({ centerId, store, dataPath }) {
  if (!centerId || !store) return false;
  const cleanCenterId = String(centerId).trim().toLowerCase();
  const resolvedDataPath = path.resolve(dataPath || './.wwebjs_auth/');

  const sessionName = `RemoteAuth-${cleanCenterId}`;
  const localDirName = `session-${cleanCenterId}`;
  const localDirPath = path.join(resolvedDataPath, localDirName);
  const localDefaultPath = path.join(localDirPath, 'Default');

  // Check if local session exists
  if (!fs.existsSync(localDefaultPath)) {
    return false;
  }

  // Check if session already exists in MongoDB
  try {
    const alreadyRemote = await store.sessionExists({ session: sessionName });
    if (alreadyRemote) {
      return false;
    }
  } catch (err) {
    console.warn(`[Migration] Could not check remote session existence for ${cleanCenterId}:`, err.message);
    return false;
  }

  console.log(`📦 [Migration] Discovered existing LocalAuth session for center '${cleanCenterId}'. Packaging for MongoDB...`);

  const tempStageDir = path.join(resolvedDataPath, `wwebjs_temp_migrate_${cleanCenterId}`);
  const tempStageDefault = path.join(tempStageDir, 'Default');
  const tempZipPath = path.join(resolvedDataPath, `${sessionName}.zip`);

  try {
    fs.mkdirSync(tempStageDefault, { recursive: true });

    // Copy required directories: IndexedDB, Local Storage
    const requiredDirs = ['IndexedDB', 'Local Storage'];
    for (const d of requiredDirs) {
      const src = path.join(localDefaultPath, d);
      if (fs.existsSync(src)) {
        const dest = path.join(tempStageDefault, d);
        fs.cpSync(src, dest, { recursive: true });
      }
    }

    // Also copy top-level session files if present (e.g. Cookies, Preferences)
    const files = fs.readdirSync(localDefaultPath, { withFileTypes: true });
    for (const file of files) {
      if (file.isFile() && (file.name.includes('Cookie') || file.name.includes('Preferences') || file.name.includes('Network'))) {
        fs.copyFileSync(path.join(localDefaultPath, file.name), path.join(tempStageDefault, file.name));
      }
    }

    // Create zip archive with root directory 'Default' using level 1 to minimize memory usage
    const archive = archiver('zip', { zlib: { level: 1 } });
    const output = fs.createWriteStream(tempZipPath);

    await new Promise((resolve, reject) => {
      output.once('close', resolve);
      output.once('error', reject);
      archive.once('error', reject);

      archive.pipe(output);
      archive.directory(tempStageDir, false);
      archive.finalize();
    });

    // Save to MongoDB store
    await store.save({
      session: sessionName,
      path: tempZipPath,
    });

    console.log(`✅ [Migration] Successfully migrated center '${cleanCenterId}' session to MongoDB RemoteAuth store!`);
    return true;
  } catch (err) {
    console.warn(`❌ [Migration] Failed to migrate LocalAuth session for ${cleanCenterId}:`, err.message);
    return false;
  } finally {
    // Clean up temporary staging files (preserve the original localDirPath!)
    try {
      if (fs.existsSync(tempStageDir)) {
        fs.rmSync(tempStageDir, { recursive: true, force: true });
      }
      if (fs.existsSync(tempZipPath)) {
        fs.rmSync(tempZipPath, { force: true });
      }
    } catch {
      // ignore
    }
  }
}

module.exports = {
  migrateLocalSessionToRemote,
};
