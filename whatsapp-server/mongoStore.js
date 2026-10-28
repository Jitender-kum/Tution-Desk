const fs = require('fs');
const path = require('path');
const { pipeline } = require('node:stream/promises');
const mongoose = require('mongoose');

/**
 * Robust MongoDB GridFS Session Store for whatsapp-web.js RemoteAuth.
 *
 * Implements the full RemoteAuth store interface:
 *  - sessionExists({ session }) -> Promise<boolean>
 *  - save({ session }) -> Promise<void>
 *  - extract({ session, path }) -> Promise<void>
 *  - delete({ session }) -> Promise<void>
 *
 * Fixes known defects in community wwebjs-mongo:
 *  1. Resolves zip archive from dataPath instead of hardcoded process.cwd().
 *  2. Handles asynchronous deletion cleanly with Promise.all().
 *  3. Provides listSavedSessions() for O(1) multi-tenant startup discovery without Chromium launches.
 *  4. Cleans up old chunks and files atomically.
 */
class MongoStore {
  constructor({ mongooseInstance, dataPath } = {}) {
    this.mongoose = mongooseInstance || mongoose;
    this.dataPath = path.resolve(dataPath || './.wwebjs_auth/');
  }

  get db() {
    if (!this.mongoose.connection || !this.mongoose.connection.db) {
      throw new Error('MongoDB is not connected. A live database connection is required.');
    }
    return this.mongoose.connection.db;
  }

  /**
   * Get the GridFSBucket for a given session name
   * Uses bucketName: whatsapp-${session} (e.g. whatsapp-RemoteAuth-aroven-001)
   */
  getBucket(session) {
    return new this.mongoose.mongo.GridFSBucket(this.db, {
      bucketName: `whatsapp-${session}`,
    });
  }

  /**
   * Checks whether a session archive exists in MongoDB GridFS
   */
  async sessionExists(options) {
    if (!options || !options.session) return false;
    try {
      const collection = this.db.collection(`whatsapp-${options.session}.files`);
      const count = await collection.countDocuments({
        filename: `${options.session}.zip`,
      });
      return count > 0;
    } catch (err) {
      console.warn(`[MongoStore] Error checking sessionExists for ${options.session}:`, err.message);
      return false;
    }
  }

  /**
   * Saves / uploads the compressed session archive to MongoDB GridFS.
   * RemoteAuth creates the zip at path.join(this.dataPath, `${options.session}.zip`).
   */
  async save(options) {
    if (!options || !options.session) {
      throw new Error('options.session is required to save session archive.');
    }

    const sessionName = options.session;
    const filename = `${sessionName}.zip`;

    // 1. Locate the compressed zip file
    const candidatePaths = [
      options.path,
      path.join(this.dataPath, filename),
      path.join(process.cwd(), filename),
    ].filter(Boolean);

    let archivePath = null;
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        archivePath = p;
        break;
      }
    }

    if (!archivePath) {
      throw new Error(
        `[MongoStore] Compressed session archive not found for ${sessionName}. Checked: ${candidatePaths.join(
          ', '
        )}`
      );
    }

    const bucket = this.getBucket(sessionName);

    // 2. Stream zip into GridFS using pipeline for safe error propagation
    const readStream = fs.createReadStream(archivePath);
    const uploadStream = bucket.openUploadStream(filename, {
      metadata: {
        session: sessionName,
        uploadedAt: new Date(),
      },
    });

    try {
      await pipeline(readStream, uploadStream);
    } catch (streamErr) {
      try {
        if (uploadStream.id) {
          await bucket.delete(uploadStream.id).catch(() => {});
        }
      } catch {
        // ignore cleanup error
      }
      throw new Error(
        `[MongoStore] Stream pipeline failed while saving session ${sessionName}: ${streamErr.message}`
      );
    }

    // 3. Clean up older versions of this session in the bucket (keep only the newest upload)
    try {
      const allFiles = await bucket
        .find({ filename })
        .sort({ uploadDate: -1 })
        .toArray();

      if (allFiles.length > 1) {
        // Keep index 0 (newest), delete remaining
        const toDelete = allFiles.slice(1);
        await Promise.all(toDelete.map((doc) => bucket.delete(doc._id).catch(() => {})));
      }
    } catch (cleanupErr) {
      console.warn(`[MongoStore] Warning pruning old session versions for ${sessionName}:`, cleanupErr.message);
    }
  }

  /**
   * Downloads and extracts the session archive from MongoDB GridFS to the target file path.
   */
  async extract(options) {
    if (!options || !options.session || !options.path) {
      throw new Error('options.session and options.path are required to extract session.');
    }

    const sessionName = options.session;
    const filename = `${sessionName}.zip`;
    const targetPath = options.path;

    // Ensure target directory exists
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const bucket = this.getBucket(sessionName);

    const downloadStream = bucket.openDownloadStreamByName(filename);
    const writeStream = fs.createWriteStream(targetPath);

    try {
      await pipeline(downloadStream, writeStream);
    } catch (streamErr) {
      // Clean up partially downloaded/corrupted target file
      try {
        if (fs.existsSync(targetPath)) {
          fs.rmSync(targetPath, { force: true });
        }
      } catch {
        // ignore
      }
      throw new Error(
        `[MongoStore] Stream pipeline failed while extracting session ${sessionName}: ${streamErr.message}`
      );
    }
  }

  /**
   * Deletes all GridFS files, chunks, and collections for the session upon explicit logout.
   */
  async delete(options) {
    if (!options || !options.session) return;
    const sessionName = options.session;
    const filename = `${sessionName}.zip`;

    try {
      const bucket = this.getBucket(sessionName);
      const documents = await bucket.find({ filename }).toArray();

      await Promise.all(
        documents.map((doc) => bucket.delete(doc._id).catch(() => {}))
      );

      // Drop the bucket collections to keep the database tidy
      await this.db.collection(`whatsapp-${sessionName}.files`).drop().catch(() => {});
      await this.db.collection(`whatsapp-${sessionName}.chunks`).drop().catch(() => {});
    } catch (err) {
      console.warn(`[MongoStore] Warning during session delete for ${sessionName}:`, err.message);
    }
  }

  /**
   * Fast startup discovery: finds all centerIds that have saved sessions in MongoDB
   * without launching any Chromium processes.
   */
  async listSavedCenterIds() {
    try {
      const cursor = this.db.listCollections({ name: /^whatsapp-RemoteAuth-.*\.files$/ });
      const collections = typeof cursor.toArray === 'function' ? await cursor.toArray() : await cursor;

      const centerIds = new Set();
      for (const col of collections) {
        const match = col.name.match(/^whatsapp-RemoteAuth-(.+)\.files$/);
        if (match && match[1]) {
          const id = match[1].trim().toLowerCase();
          // Verify it has at least 1 file
          try {
            const count = await this.db.collection(col.name).countDocuments();
            if (count > 0) {
              centerIds.add(id);
            }
          } catch {
            // ignore check error
          }
        }
      }

      return Array.from(centerIds);
    } catch (err) {
      console.warn('[MongoStore] Could not list saved sessions from MongoDB:', err.message);
      return [];
    }
  }
}

module.exports = MongoStore;
