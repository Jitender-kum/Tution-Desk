const express = require("express");
const cors = require("cors");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client, RemoteAuth, LocalAuth } = require("whatsapp-web.js");
const mongoose = require("mongoose");
const MongoStore = require("./mongoStore");
const { migrateLocalSessionToRemote } = require("./sessionMigration");

// Load local .env safely using Node native API if file exists, without overwriting existing env
const envFilePath = path.join(__dirname, ".env");
if (fs.existsSync(envFilePath) && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(envFilePath);
  } catch (err) {
    console.warn("Notice: Could not load local .env file:", err.message);
  }
}

// Database initialization for RemoteAuth persistence
let mongoStore = null;
let isMongoConnected = false;
let mongoInitPromise = null;
const MONGODB_URI = process.env.MONGODB_URI;

async function initMongoDB() {
  if (!MONGODB_URI || !MONGODB_URI.trim()) {
    console.warn(
      "⚠️ [Database] MONGODB_URI not provided. WhatsApp sessions will use ephemeral LocalAuth (Render restarts will require QR pairing)."
    );
    return;
  }

  try {
    console.log("🔌 [Database] Connecting to MongoDB for WhatsApp session persistence...");
    await mongoose.connect(MONGODB_URI.trim(), {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
      maxPoolSize: 5,
    });
    isMongoConnected = true;
    mongoStore = new MongoStore({
      mongooseInstance: mongoose,
      dataPath: "./.wwebjs_auth",
    });
    console.log("✅ [Database] MongoDB connected successfully for RemoteAuth session persistence.");

    // Fast O(1) startup discovery across all centers without launching Chromium
    const savedRemoteCenters = await mongoStore.listSavedCenterIds();
    for (const id of savedRemoteCenters) {
      savedSessionCenters.add(id);
      console.log(
        `📁 [Database] Discovered saved remote session for center: ${id} (lazy on-demand ready)`
      );
    }
  } catch (err) {
    isMongoConnected = false;
    mongoStore = null;
    console.error(
      "❌ [Database] Failed to connect to MongoDB for session persistence:",
      err.message
    );
    console.warn(
      "⚠️ [Database] Falling back to ephemeral LocalAuth until MongoDB is accessible."
    );
  }
}

mongoose.connection.on("disconnected", () => {
  isMongoConnected = false;
  console.warn(
    "⚠️ [Database] MongoDB disconnected. RemoteAuth persistence may be temporarily unavailable."
  );
});

mongoose.connection.on("reconnected", () => {
  isMongoConnected = true;
  console.log("✅ [Database] MongoDB reconnected.");
});

// Kick off MongoDB connection early
mongoInitPromise = initMongoDB();

// Validate WHATSAPP_INTERNAL_SECRET at startup and fail closed if missing or blank
const INTERNAL_SECRET = process.env.WHATSAPP_INTERNAL_SECRET;
if (!INTERNAL_SECRET || !INTERNAL_SECRET.trim()) {
  console.error(
    "FATAL: WHATSAPP_INTERNAL_SECRET environment variable is missing or empty. Microservice cannot start."
  );
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3005;
const HOST = process.env.WHATSAPP_HOST || "0.0.0.0";

// Middleware
app.use(cors());
app.use(express.json());

/**
 * Health check endpoint for orchestrators (e.g. Render)
 * Reports HTTP service health and persistence configuration status.
 * Does not require internal secret.
 */
app.get("/health", (req, res) => {
  const isConfigured = Boolean(MONGODB_URI && MONGODB_URI.trim());
  const persistenceStatus = isMongoConnected
    ? "connected"
    : isConfigured
    ? "connecting_or_disconnected"
    : "unconfigured_ephemeral";

  const isDegraded = isConfigured && !isMongoConnected;

  res.status(isDegraded ? 503 : 200).json({
    status: isDegraded ? "degraded" : "ok",
    service: "tuitiondesk-whatsapp",
    persistence: {
      mode: isMongoConnected ? "mongodb_remote" : "ephemeral_local",
      status: persistenceStatus,
      durable: Boolean(isMongoConnected),
    },
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Constant-time comparison for internal secret to prevent timing side-channel attacks
 */
function isInternalSecretValid(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") {
    return false;
  }
  const provBuf = Buffer.from(provided, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (provBuf.length !== expBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(provBuf, expBuf);
}

/**
 * Internal authentication middleware for all service requests
 */
function authenticateInternalSecret(req, res, next) {
  const providedSecret = req.headers["x-internal-secret"];

  if (!providedSecret || typeof providedSecret !== "string") {
    return res.status(401).json({
      success: false,
      error: "Unauthorized: Missing internal service secret header (x-internal-secret).",
    });
  }

  if (!isInternalSecretValid(providedSecret.trim(), INTERNAL_SECRET.trim())) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized: Invalid internal service secret.",
    });
  }

  next();
}

app.use(authenticateInternalSecret);


// Global Map to store active clients and states per center
// key: centerId (string), value: { centerId, client, status, qr, qrGeneratedAt, isReady, error, updatedAt }
const sessions = new Map();

// Unified per-center operation locks to prevent race conditions across /init, /reconnect, /logout
const activeLocks = new Set();

// In-flight initialization promises to deduplicate concurrent /init requests: centerId -> Promise<sessionObj>
const inFlightInitPromises = new Map();

// Set of centerIds that have saved authentication directories on disk (lazy on-demand startup)
const savedSessionCenters = new Set();

/**
 * Safely destroys a Puppeteer client instance with a bounded timeout and cleans all listeners.
 * Prevents orphaned Chromium processes and zombie pages from leaking RAM.
 */
async function destroyClientSafely(client, centerId) {
  if (!client) return;
  try {
    if (typeof client.removeAllListeners === "function") {
      client.removeAllListeners();
    }
    const destroyPromise = client.destroy().catch((err) => {
      console.warn(
        `[Center: ${centerId}] Warning during client destroy:`,
        err?.message || err
      );
    });
    // Bounded timeout of 5 seconds so client destruction never hangs the event loop
    const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 5000));
    await Promise.race([destroyPromise, timeoutPromise]);
  } catch (err) {
    console.warn(
      `[Center: ${centerId}] Exception destroying client:`,
      err?.message || err
    );
  }
}

// Determine Chrome / Chromium executable path on Linux (Render) and Windows
const CHROME_PATHS = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Google\\Chrome\\Application\\chrome.exe")
    : null,
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

function getExecutablePath() {
  // 1. Explicitly check PUPPETEER_EXECUTABLE_PATH environment variable
  const envPath =
    process.env.PUPPETEER_EXECUTABLE_PATH &&
    process.env.PUPPETEER_EXECUTABLE_PATH.trim();
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  // 2. Explicitly check standard Linux Chromium binary path
  const linuxChromium = "/usr/bin/chromium";
  if (fs.existsSync(linuxChromium)) {
    return linuxChromium;
  }

  // 3. Fallback to other known system browser paths
  for (const p of CHROME_PATHS) {
    if (p && fs.existsSync(p)) {
      return p;
    }
  }

  return undefined;
}

const chromePath = getExecutablePath();
if (chromePath) {
  console.log(`[Browser Engine] Using system browser executable: ${chromePath}`);
} else {
  console.warn(
    "[Browser Engine] No system browser found at PUPPETEER_EXECUTABLE_PATH, /usr/bin/chromium, or standard paths. Puppeteer will fall back to bundled browser."
  );
}

/**
 * Format raw phone number to standard WhatsApp chat ID: 91<number>@c.us
 */
function formatWhatsAppId(phone) {
  if (!phone) return null;
  let cleaned = String(phone).replace(/\D/g, "");

  if (cleaned.length === 10) {
    cleaned = "91" + cleaned;
  } else if (cleaned.length === 12 && cleaned.startsWith("91")) {
    // already starts with country code 91
  } else if (cleaned.startsWith("0") && cleaned.length === 11) {
    cleaned = "91" + cleaned.substring(1);
  }

  return `${cleaned}@c.us`;
}

/**
 * Migrate legacy single-client session to 'aroven-001' if present
 */
function migrateLegacySession() {
  const legacyDir = path.join(__dirname, ".wwebjs_auth", "session");
  const arovenDir = path.join(__dirname, ".wwebjs_auth", "session-aroven-001");
  try {
    if (fs.existsSync(legacyDir) && !fs.existsSync(arovenDir)) {
      console.log("📦 Migrating existing session to session-aroven-001...");
      fs.cpSync(legacyDir, arovenDir, { recursive: true });
    }
  } catch (err) {
    console.warn("Could not copy legacy session:", err.message);
  }
}
migrateLegacySession();

/**
 * Helper: Initializes a new WhatsApp Web client for a specific Center
 */
async function initializeClient(centerId) {
  if (!centerId) throw new Error("centerId is required to initialize client");
  const cleanCenterId = String(centerId).trim().toLowerCase();

  // If already exists and in active or initializing state, return existing
  if (sessions.has(cleanCenterId)) {
    const existing = sessions.get(cleanCenterId);
    if (
      existing.status === "connected" ||
      existing.status === "qr_ready" ||
      existing.status === "initializing" ||
      existing.status === "authenticated"
    ) {
      console.log(
        `[Session: ${cleanCenterId}] Returning existing active session (Status: ${existing.status})`
      );
      return existing;
    }

    // If previous client is in disconnected/errored state, safely destroy it before re-instantiating
    if (existing.client) {
      console.log(
        `[Session: ${cleanCenterId}] Cleaning up stale/disconnected client process before re-initializing...`
      );
      await destroyClientSafely(existing.client, cleanCenterId);
      existing.client = null;
    }
  }

  // Await in-flight MongoDB initialization if server just booted
  if (mongoInitPromise) {
    try {
      await mongoInitPromise;
    } catch {
      // ignore
    }
  }

  // If MongoDB persistence was explicitly configured but is currently disconnected,
  // halt initialization to protect session state rather than silently creating an ephemeral session.
  if (MONGODB_URI && MONGODB_URI.trim() && !isMongoConnected) {
    throw new Error(
      "Persistent session storage (MongoDB) is configured but currently unavailable. Halting client launch to protect session state."
    );
  }

  // If this center is known to have a saved session, but MongoDB is not connected, halt launch.
  if (savedSessionCenters.has(cleanCenterId) && !isMongoConnected) {
    throw new Error(
      `Center '${cleanCenterId}' has a saved session, but persistent storage (MongoDB) is unavailable. Halting Chromium launch to prevent session overwrite.`
    );
  }

  const resolvedExecutable = getExecutablePath() || chromePath;

  let authStrategy;
  if (mongoStore && isMongoConnected) {
    // Check and migrate existing LocalAuth directory to MongoDB before RemoteAuth runs
    try {
      await migrateLocalSessionToRemote({
        centerId: cleanCenterId,
        store: mongoStore,
        dataPath: "./.wwebjs_auth",
      });
    } catch (migErr) {
      console.warn(`[Center: ${cleanCenterId}] LocalAuth migration notice:`, migErr.message);
    }

    console.log(
      `[Session: ${cleanCenterId}] Initializing WhatsApp Web Client with RemoteAuth (MongoDB, Browser: ${
        resolvedExecutable || "bundled-fallback"
      })...`
    );

    authStrategy = new RemoteAuth({
      clientId: cleanCenterId,
      store: mongoStore,
      backupSyncIntervalMs: 300000, // 5 minutes periodic sync
      dataPath: "./.wwebjs_auth",
    });
  } else {
    console.log(
      `[Session: ${cleanCenterId}] Initializing WhatsApp Web Client with LocalAuth fallback (Browser: ${
        resolvedExecutable || "bundled-fallback"
      })...`
    );

    authStrategy = new LocalAuth({
      clientId: cleanCenterId,
      dataPath: "./.wwebjs_auth",
    });
  }

  const client = new Client({
    authStrategy,
    puppeteer: {
      headless: true,
      executablePath: resolvedExecutable || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-default-apps",
        "--disable-component-extensions-with-background-pages",
        "--mute-audio",
        "--no-default-browser-check",
        "--disable-breakpad",
        "--disable-component-update",
        "--renderer-process-limit=1",
        "--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints",
      ],
    },
  });

  const sessionObj = {
    centerId: cleanCenterId,
    client,
    status: "initializing",
    qr: null,
    qrGeneratedAt: null,
    isReady: false,
    updatedAt: new Date().toISOString(),
  };

  sessions.set(cleanCenterId, sessionObj);

  // Event: QR Code generated
  client.on("qr", (qr) => {
    sessionObj.qr = qr;
    sessionObj.qrGeneratedAt = Date.now();
    sessionObj.status = "qr_ready";
    sessionObj.isReady = false;
    sessionObj.updatedAt = new Date().toISOString();
    console.log(`\n==================================================`);
    console.log(
      `📱 [Center: ${cleanCenterId}] Scan this QR code with WhatsApp:`
    );
    console.log(`==================================================`);
    qrcode.generate(qr, { small: true });
    console.log(`==================================================\n`);
  });

  // Event: Authenticated
  client.on("authenticated", () => {
    sessionObj.status = "authenticated";
    sessionObj.qr = null;
    sessionObj.qrGeneratedAt = null;
    sessionObj.isReady = false;
    sessionObj.updatedAt = new Date().toISOString();
    console.log(
      `🔐 [Center: ${cleanCenterId}] WhatsApp Client Authenticated Successfully. Awaiting ready event...`
    );
  });

  // Event: Ready
  client.on("ready", () => {
    sessionObj.status = "connected";
    sessionObj.isReady = true;
    sessionObj.qr = null;
    sessionObj.qrGeneratedAt = null;
    sessionObj.error = null;
    sessionObj.updatedAt = new Date().toISOString();
    console.log(`\n==================================================`);
    console.log(`✅ [Center: ${cleanCenterId}] WhatsApp Client is Ready!`);
    console.log(`==================================================\n`);
  });

  // Event: Remote session saved to MongoDB
  client.on("remote_session_saved", () => {
    savedSessionCenters.add(cleanCenterId);
    console.log(
      `💾 [Center: ${cleanCenterId}] WhatsApp session backed up to MongoDB successfully.`
    );
  });

  // Event: Auth Failure
  client.on("auth_failure", async (msg) => {
    sessionObj.status = "disconnected";
    sessionObj.isReady = false;
    sessionObj.qr = null;
    sessionObj.qrGeneratedAt = null;
    sessionObj.error = msg;
    sessionObj.updatedAt = new Date().toISOString();
    console.error(
      `❌ [Center: ${cleanCenterId}] WhatsApp Authentication Failure:`,
      msg
    );
    // Destroy client process safely on auth failure to free memory
    await destroyClientSafely(client, cleanCenterId);
    sessionObj.client = null;
  });

  // Event: Disconnected
  client.on("disconnected", async (reason) => {
    sessionObj.status = "disconnected";
    sessionObj.isReady = false;
    sessionObj.qr = null;
    sessionObj.qrGeneratedAt = null;
    sessionObj.updatedAt = new Date().toISOString();
    console.warn(
      `⚠️ [Center: ${cleanCenterId}] WhatsApp Client Disconnected:`,
      reason
    );
    // Destroy client process safely on disconnect to free memory
    await destroyClientSafely(client, cleanCenterId);
    sessionObj.client = null;
  });

  // Start initialization
  client.initialize().catch(async (err) => {
    console.error(
      `❌ [Center: ${cleanCenterId}] Client initialization failed:`,
      err?.message || err
    );
    sessionObj.status = "disconnected";
    sessionObj.isReady = false;
    sessionObj.error = err instanceof Error ? err.message : String(err);
    sessionObj.updatedAt = new Date().toISOString();
    // Destroy client process on initialization failure to prevent orphaned browser
    await destroyClientSafely(client, cleanCenterId);
    sessionObj.client = null;
  });

  return sessionObj;
}

// -------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------

/**
 * Global health and diagnostics endpoint
 * Exposes lightweight runtime memory, active client counts, and session states.
 * Never exposes QR payloads, phone numbers, or credentials.
 */
app.get("/status", (req, res) => {
  const mem = process.memoryUsage();
  let activeClientsCount = 0;
  let readySessionsCount = 0;

  const sessionSummaries = [];
  for (const [id, s] of sessions.entries()) {
    if (s.client) activeClientsCount++;
    if (s.isReady) readySessionsCount++;
    sessionSummaries.push({
      centerId: id,
      status: s.status,
      ready: s.isReady,
      hasQR: Boolean(s.qr),
      hasClientProcess: Boolean(s.client),
      updatedAt: s.updatedAt,
    });
  }

  res.json({
    success: true,
    service: "WhatsApp Multi-Tenant Automation Microservice",
    uptimeSeconds: Math.floor(process.uptime()),
    memory: {
      rssMb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
      heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
      heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
      externalMb: Math.round((mem.external / 1024 / 1024) * 100) / 100,
    },
    counts: {
      totalTrackedSessions: sessions.size,
      activeClientProcesses: activeClientsCount,
      readySessions: readySessionsCount,
      activeLocks: activeLocks.size,
      savedSessions: savedSessionCenters.size,
      isMongoConnected,
    },
    persistence: {
      mode: isMongoConnected ? "mongodb_remote" : "ephemeral_local",
      status: isMongoConnected
        ? "connected"
        : MONGODB_URI && MONGODB_URI.trim()
        ? "error_disconnected"
        : "unconfigured_ephemeral",
      durable: Boolean(isMongoConnected),
    },
    sessions: sessionSummaries,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /status/:centerId
 * Returns the specific status and QR code for that center.
 * Does not initialize or launch Chromium as a side effect.
 */
app.get("/status/:centerId", async (req, res) => {
  const cleanCenterId = String(req.params.centerId || "")
    .trim()
    .toLowerCase();

  if (!cleanCenterId) {
    return res.status(400).json({
      success: false,
      error: "centerId is required",
    });
  }

  // Await in-flight MongoDB initialization if server just booted
  if (mongoInitPromise) {
    try {
      await mongoInitPromise;
    } catch {
      // ignore
    }
  }

  // Check in-memory registry or query MongoDB directly as source of truth
  let hasSavedSession = savedSessionCenters.has(cleanCenterId);
  if (!hasSavedSession && mongoStore && isMongoConnected) {
    try {
      hasSavedSession = await mongoStore.sessionExists({
        session: `RemoteAuth-${cleanCenterId}`,
      });
      if (hasSavedSession) {
        savedSessionCenters.add(cleanCenterId);
      }
    } catch {
      // ignore check error
    }
  }

  const session = sessions.get(cleanCenterId);

  if (!session) {
    return res.json({
      success: true,
      centerId: cleanCenterId,
      status: "disconnected",
      hasSavedSession,
      qr: null,
      qrGeneratedAt: null,
      ready: false,
      service: "WhatsApp Multi-Tenant Automation Microservice",
      timestamp: new Date().toISOString(),
    });
  }

  return res.json({
    success: true,
    centerId: cleanCenterId,
    status: session.status,
    hasSavedSession,
    qr: session.qr,
    qrGeneratedAt: session.qrGeneratedAt || null,
    ready: session.isReady,
    hasClientProcess: Boolean(session.client),
    error: session.error || undefined,
    service: "WhatsApp Multi-Tenant Automation Microservice",
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /init/:centerId
 * Calls initializeClient(centerId) safely.
 * Deduplicates in-flight initialization requests and prevents multiple Chromium launches.
 */
app.post("/init/:centerId", async (req, res) => {
  const cleanCenterId = String(req.params.centerId || "")
    .trim()
    .toLowerCase();

  if (!cleanCenterId) {
    return res.status(400).json({
      success: false,
      error: "centerId is required",
    });
  }

  // 1. If already active or initializing, return existing without launching another browser
  if (sessions.has(cleanCenterId)) {
    const existing = sessions.get(cleanCenterId);
    if (
      existing.status === "connected" ||
      existing.status === "qr_ready" ||
      existing.status === "initializing" ||
      existing.status === "authenticated"
    ) {
      return res.json({
        success: true,
        centerId: cleanCenterId,
        status: existing.status,
        qr: existing.qr,
        qrGeneratedAt: existing.qrGeneratedAt || null,
        ready: existing.isReady,
        message: `WhatsApp client is already active for center: ${cleanCenterId}`,
      });
    }
  }

  // 2. If an in-flight initialization promise exists for this center, await it (deduplicate concurrent requests)
  if (inFlightInitPromises.has(cleanCenterId)) {
    try {
      const session = await inFlightInitPromises.get(cleanCenterId);
      return res.json({
        success: true,
        centerId: cleanCenterId,
        status: session.status,
        qr: session.qr,
        qrGeneratedAt: session.qrGeneratedAt || null,
        ready: session.isReady,
        message: `WhatsApp client initialized for center: ${cleanCenterId}`,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : "Failed to initialize client",
      });
    }
  }

  // 3. Prevent race conditions if a reconnect or logout operation is currently running
  if (activeLocks.has(cleanCenterId)) {
    return res.status(409).json({
      success: false,
      error: "An operation is already in progress for this center. Please wait a moment.",
    });
  }

  activeLocks.add(cleanCenterId);
  const initPromise = (async () => {
    try {
      return await initializeClient(cleanCenterId);
    } finally {
      activeLocks.delete(cleanCenterId);
      inFlightInitPromises.delete(cleanCenterId);
    }
  })();

  inFlightInitPromises.set(cleanCenterId, initPromise);

  try {
    const session = await initPromise;
    return res.json({
      success: true,
      centerId: cleanCenterId,
      status: session.status,
      qr: session.qr,
      qrGeneratedAt: session.qrGeneratedAt || null,
      ready: session.isReady,
      message: `WhatsApp client initialized for center: ${cleanCenterId}`,
    });
  } catch (err) {
    console.error(`Error initializing center ${cleanCenterId}:`, err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to initialize client",
    });
  }
});

/**
 * POST /reconnect/:centerId
 * Refreshes an unlinked/stale WhatsApp session to generate a fresh QR code.
 * Refuses reconnection if the session is already active and connected.
 */
app.post("/reconnect/:centerId", async (req, res) => {
  const cleanCenterId = String(req.params.centerId || "")
    .trim()
    .toLowerCase();

  if (!cleanCenterId) {
    return res.status(400).json({
      success: false,
      error: "centerId is required",
    });
  }

  // Prevent concurrent operations (init, reconnect, or logout)
  if (activeLocks.has(cleanCenterId) || inFlightInitPromises.has(cleanCenterId)) {
    return res.status(409).json({
      success: false,
      error: "An operation is already in progress for this center. Please wait a moment.",
    });
  }

  const existing = sessions.get(cleanCenterId);

  // If session is already connected, refuse reconnection to preserve active connection
  if (existing && (existing.status === "connected" || existing.isReady === true)) {
    return res.status(400).json({
      success: false,
      centerId: cleanCenterId,
      status: "connected",
      ready: true,
      error:
        "Cannot regenerate QR code for an active connected session. Please disconnect first if you wish to link a new number.",
    });
  }

  // If session is currently initializing or authenticating, refuse concurrent reconnect
  if (existing && (existing.status === "initializing" || existing.status === "authenticated")) {
    return res.status(409).json({
      success: false,
      centerId: cleanCenterId,
      status: existing.status,
      error:
        "WhatsApp client is currently initializing for this center. Please wait a moment before requesting another QR.",
    });
  }

  activeLocks.add(cleanCenterId);

  try {
    console.log(
      `[Center: ${cleanCenterId}] Reconnecting session: safely destroying previous client and requesting fresh QR...`
    );

    // Safely destroy existing client if present, without deleting credentials on disk
    if (existing && existing.client) {
      await destroyClientSafely(existing.client, cleanCenterId);
      existing.client = null;
    }

    // Remove stale session from memory
    sessions.delete(cleanCenterId);

    // Only delete remote session if an explicit user-requested new-pairing action is confirmed
    const isExplicitNewPairing =
      req.body?.action === "new_pairing" ||
      req.query?.action === "new_pairing" ||
      Boolean(req.body?.forceNewPairing);

    if (isExplicitNewPairing) {
      if (mongoStore && isMongoConnected) {
        try {
          await mongoStore.delete({ session: `RemoteAuth-${cleanCenterId}` });
          savedSessionCenters.delete(cleanCenterId);
          console.log(
            `🗑️ Explicit new-pairing confirmed: Cleared remote session in MongoDB for center: ${cleanCenterId}`
          );
        } catch (delErr) {
          console.error(
            `❌ Failed to clear remote session on explicit new-pairing for ${cleanCenterId}:`,
            delErr.message
          );
          throw new Error(
            `Failed to clear previous saved session during new pairing: ${delErr.message}`
          );
        }
      }

      try {
        const localRemoteDir = path.join(__dirname, ".wwebjs_auth", `RemoteAuth-${cleanCenterId}`);
        if (fs.existsSync(localRemoteDir)) {
          fs.rmSync(localRemoteDir, { recursive: true, force: true });
        }
      } catch {
        // ignore
      }
    } else {
      console.log(
        `[Center: ${cleanCenterId}] Reconnect: preserving existing MongoDB credentials and attempting session restoration.`
      );
    }

    // Spawn fresh client (restores saved session if present; generates fresh QR if unlinked)
    const newSession = await initializeClient(cleanCenterId);

    return res.json({
      success: true,
      centerId: cleanCenterId,
      status: newSession.status,
      qr: newSession.qr,
      qrGeneratedAt: newSession.qrGeneratedAt || null,
      ready: newSession.isReady,
      message: `Fresh QR generation initiated for center: ${cleanCenterId}`,
    });
  } catch (err) {
    console.error(`[Center: ${cleanCenterId}] Reconnect failed:`, err);
    return res.status(500).json({
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to reconnect WhatsApp client",
    });
  } finally {
    activeLocks.delete(cleanCenterId);
  }
});

/**
 * POST /send-message
 * Body: { centerId: string, phone: string, message: string }
 */
app.post("/send-message", async (req, res) => {
  try {
    const { centerId, phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({
        success: false,
        error: "Both 'phone' and 'message' are required.",
      });
    }

    // Resolve target centerId
    let targetCenterId = centerId ? String(centerId).trim().toLowerCase() : null;

    // Fallback: If only 1 session exists, use it
    if (!targetCenterId && sessions.size === 1) {
      targetCenterId = Array.from(sessions.keys())[0];
    }

    if (!targetCenterId) {
      return res.status(400).json({
        success: false,
        error: "centerId is required in request body to route message to the correct WhatsApp session.",
      });
    }

    const session = sessions.get(targetCenterId);

    if (!session || !session.isReady || !session.client) {
      return res.status(503).json({
        success: false,
        error: `WhatsApp Client for center '${targetCenterId}' is not ready. Please scan the QR code in Settings.`,
        centerId: targetCenterId,
        status: session ? session.status : "disconnected",
      });
    }

    const formattedPhone = formatWhatsAppId(phone);

    if (!formattedPhone) {
      return res.status(400).json({
        success: false,
        error: "Invalid phone number format.",
      });
    }

    console.log(
      `[Center: ${targetCenterId}] [OUTGOING] Sending to ${formattedPhone}...`
    );

    // Verify if number is registered on WhatsApp before attempting send
    try {
      const isRegistered = await session.client.isRegisteredUser(formattedPhone);
      if (!isRegistered) {
        console.warn(
          `⚠️ [Center: ${targetCenterId}] Number not registered on WhatsApp: ${formattedPhone}`
        );
        return res.status(404).json({
          success: false,
          error: "Number not registered on WhatsApp",
        });
      }
    } catch (regErr) {
      console.warn(
        `⚠️ [Center: ${targetCenterId}] Failed to verify registration for ${formattedPhone}:`,
        regErr
      );
    }

    // Dedicated try...catch block to avoid crashing node process
    let response;
    try {
      response = await session.client.sendMessage(formattedPhone, message);
    } catch (sendErr) {
      console.error(
        `❌ [Center: ${targetCenterId}] Error dispatching WhatsApp message:`,
        sendErr
      );
      return res.status(500).json({
        success: false,
        error:
          sendErr instanceof Error
            ? sendErr.message
            : "Failed to send WhatsApp message.",
      });
    }

    console.log(
      `✅ [Center: ${targetCenterId}] Dispatched to ${formattedPhone}! ID: ${
        response?.id?._serialized || response?.id || "sent"
      }`
    );

    return res.json({
      success: true,
      centerId: targetCenterId,
      messageId: response?.id?._serialized || response?.id || "sent",
      recipient: formattedPhone,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("❌ Unexpected error in /send-message route:", err);
    return res.status(500).json({
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to send WhatsApp message.",
    });
  }
});

/**
 * POST /logout/:centerId
 * Calls client.logout() and deletes the session from the Map so a new number can be linked.
 */
app.post("/logout/:centerId", async (req, res) => {
  const cleanCenterId = String(req.params.centerId || "")
    .trim()
    .toLowerCase();

  if (!cleanCenterId) {
    return res.status(400).json({
      success: false,
      error: "centerId is required",
    });
  }

  // Prevent concurrent operation during logout
  if (activeLocks.has(cleanCenterId)) {
    return res.status(409).json({
      success: false,
      error: "An operation is already in progress for this center. Please wait a moment.",
    });
  }

  activeLocks.add(cleanCenterId);

  try {
    const session = sessions.get(cleanCenterId);

    if (!session) {
      return res.json({
        success: true,
        message: `No active session found for center: ${cleanCenterId}`,
      });
    }

    console.log(`[Center: ${cleanCenterId}] Logging out and clearing session...`);

    if (session.client) {
      try {
        await session.client.logout().catch((e) => {
          console.warn(`Logout error for ${cleanCenterId}:`, e.message);
        });
      } catch (err) {
        console.warn(`Error during client logout for ${cleanCenterId}:`, err.message);
      }
      await destroyClientSafely(session.client, cleanCenterId);
      session.client = null;
    }

    sessions.delete(cleanCenterId);
    savedSessionCenters.delete(cleanCenterId);

    // Delete remote session from MongoDB
    if (mongoStore && isMongoConnected) {
      try {
        await mongoStore.delete({ session: `RemoteAuth-${cleanCenterId}` });
        console.log(`🗑️ Deleted remote session in MongoDB for center: ${cleanCenterId}`);
      } catch (dbErr) {
        console.warn(`Could not delete remote session from MongoDB for ${cleanCenterId}:`, dbErr.message);
      }
    }

    // Clean up local auth directories for this center only on explicit logout
    try {
      const dirsToClean = [
        path.join(__dirname, ".wwebjs_auth", `RemoteAuth-${cleanCenterId}`),
        path.join(__dirname, ".wwebjs_auth", `session-${cleanCenterId}`),
      ];
      for (const d of dirsToClean) {
        if (fs.existsSync(d)) {
          fs.rmSync(d, { recursive: true, force: true });
          console.log(`🗑️ Removed local session cache directory: ${path.basename(d)}`);
        }
      }
    } catch (cleanupErr) {
      console.warn("Could not delete session directory:", cleanupErr.message);
    }

    return res.json({
      success: true,
      centerId: cleanCenterId,
      message: `WhatsApp session disconnected for center: ${cleanCenterId}. Ready for fresh pairing.`,
    });
  } catch (err) {
    console.error(`Logout failed for ${cleanCenterId}:`, err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to logout session",
    });
  } finally {
    activeLocks.delete(cleanCenterId);
  }
});

// Scan saved session directories for awareness without eagerly launching Chromium
try {
  const authRoot = path.join(__dirname, ".wwebjs_auth");
  if (fs.existsSync(authRoot)) {
    const entries = fs.readdirSync(authRoot, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        let id = null;
        if (ent.name.startsWith("RemoteAuth-")) {
          id = ent.name.replace("RemoteAuth-", "").trim().toLowerCase();
        } else if (ent.name.startsWith("session-")) {
          id = ent.name.replace("session-", "").trim().toLowerCase();
        }
        if (id) {
          savedSessionCenters.add(id);
          console.log(
            `📁 Discovered saved session directory for center: ${id} (lazy on-demand startup ready)`
          );
        }
      }
    }
  }
} catch (scanErr) {
  console.warn("Could not scan saved sessions:", scanErr.message);
}

// Start Express Server
const server = app.listen(PORT, HOST, () => {
  console.log(`🚀 Multi-Tenant WhatsApp Microservice listening on http://${HOST}:${PORT}`);
});

// Graceful shutdown handling with bounded client cleanup
let isShuttingDown = false;
async function handleGracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown of WhatsApp Microservice...`);

  // Close HTTP server to stop accepting new requests
  server.close(() => {
    console.log("🔒 HTTP server closed to new connections.");
  });

  const destroyPromises = [];
  for (const [centerId, session] of sessions.entries()) {
    if (session.client) {
      console.log(`[Center: ${centerId}] Closing WhatsApp client on shutdown...`);
      destroyPromises.push(destroyClientSafely(session.client, centerId));
    }
  }

  // Close MongoDB connection cleanly
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    destroyPromises.push(
      mongoose.connection.close().catch((err) => {
        console.warn("Warning closing MongoDB connection:", err?.message || err);
      })
    );
  }

  // Bounded timeout: max 5 seconds for cleanup before exiting
  const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 5000));
  await Promise.race([Promise.allSettled(destroyPromises), timeoutPromise]);

  console.log("👋 Graceful shutdown complete. Exiting process.");
  process.exit(0);
}

process.on("SIGTERM", () => handleGracefulShutdown("SIGTERM"));
process.on("SIGINT", () => handleGracefulShutdown("SIGINT"));

// Guard against unhandled library exceptions to keep server resilient
process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Unhandled Rejection in WhatsApp Server:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("⚠️ Uncaught Exception in WhatsApp Server:", err);
});
