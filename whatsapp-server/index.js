const express = require("express");
const cors = require("cors");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client, LocalAuth } = require("whatsapp-web.js");

// Load local .env safely using Node native API if file exists, without overwriting existing env
const envFilePath = path.join(__dirname, ".env");
if (fs.existsSync(envFilePath) && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(envFilePath);
  } catch (err) {
    console.warn("Notice: Could not load local .env file:", err.message);
  }
}

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
const HOST = process.env.WHATSAPP_HOST || "127.0.0.1";

// Middleware
app.use(cors());
app.use(express.json());

/**
 * Health check endpoint for orchestrators (e.g. Render)
 * Reports HTTP service health only. Does not require internal secret.
 */
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", service: "tuitiondesk-whatsapp" });
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
// key: centerId (string), value: { centerId, client, status, qr, isReady, error, updatedAt }
const sessions = new Map();

// Determine Chrome / Chromium executable path on Windows
const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

function getExecutablePath() {
  if (
    process.env.PUPPETEER_EXECUTABLE_PATH &&
    fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)
  ) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  for (const p of CHROME_PATHS) {
    if (p && fs.existsSync(p)) {
      return p;
    }
  }
  return undefined;
}

const chromePath = getExecutablePath();
if (chromePath) {
  console.log(`[Browser Engine] Using system browser: ${chromePath}`);
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
function initializeClient(centerId) {
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
  }

  console.log(
    `[Session: ${cleanCenterId}] Initializing WhatsApp Web Client with LocalAuth clientId...`
  );

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: cleanCenterId,
      dataPath: "./.wwebjs_auth",
    }),
    puppeteer: {
      headless: true,
      executablePath: chromePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
    },
  });

  const sessionObj = {
    centerId: cleanCenterId,
    client,
    status: "initializing",
    qr: null,
    isReady: false,
    updatedAt: new Date().toISOString(),
  };

  sessions.set(cleanCenterId, sessionObj);

  // Event: QR Code generated
  client.on("qr", (qr) => {
    sessionObj.qr = qr;
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
    sessionObj.updatedAt = new Date().toISOString();
    console.log(
      `🔐 [Center: ${cleanCenterId}] WhatsApp Client Authenticated Successfully.`
    );
  });

  // Event: Ready
  client.on("ready", () => {
    sessionObj.status = "connected";
    sessionObj.isReady = true;
    sessionObj.qr = null;
    sessionObj.updatedAt = new Date().toISOString();
    console.log(`\n==================================================`);
    console.log(`✅ [Center: ${cleanCenterId}] WhatsApp Client is Ready!`);
    console.log(`==================================================\n`);
  });

  // Event: Auth Failure
  client.on("auth_failure", (msg) => {
    sessionObj.status = "disconnected";
    sessionObj.isReady = false;
    sessionObj.qr = null;
    sessionObj.error = msg;
    sessionObj.updatedAt = new Date().toISOString();
    console.error(
      `❌ [Center: ${cleanCenterId}] WhatsApp Authentication Failure:`,
      msg
    );
  });

  // Event: Disconnected
  client.on("disconnected", (reason) => {
    sessionObj.status = "disconnected";
    sessionObj.isReady = false;
    sessionObj.qr = null;
    sessionObj.updatedAt = new Date().toISOString();
    console.warn(
      `⚠️ [Center: ${cleanCenterId}] WhatsApp Client Disconnected:`,
      reason
    );
  });

  // Start initialization
  client.initialize().catch((err) => {
    console.error(
      `❌ [Center: ${cleanCenterId}] Client initialization failed:`,
      err
    );
    sessionObj.status = "disconnected";
    sessionObj.isReady = false;
    sessionObj.error = err instanceof Error ? err.message : String(err);
  });

  return sessionObj;
}

// -------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------

/**
 * Global health check endpoint
 */
app.get("/status", (req, res) => {
  const activeSessions = [];
  for (const [id, s] of sessions.entries()) {
    activeSessions.push({
      centerId: id,
      status: s.status,
      ready: s.isReady,
      hasQR: Boolean(s.qr),
    });
  }

  res.json({
    success: true,
    service: "WhatsApp Multi-Tenant Automation Microservice",
    totalSessions: sessions.size,
    sessions: activeSessions,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /status/:centerId
 * Returns the specific status and QR code for that center.
 */
app.get("/status/:centerId", (req, res) => {
  const cleanCenterId = String(req.params.centerId || "")
    .trim()
    .toLowerCase();

  if (!cleanCenterId) {
    return res.status(400).json({
      success: false,
      error: "centerId is required",
    });
  }

  const session = sessions.get(cleanCenterId);

  if (!session) {
    return res.json({
      success: true,
      centerId: cleanCenterId,
      status: "disconnected",
      qr: null,
      ready: false,
      service: "WhatsApp Multi-Tenant Automation Microservice",
      timestamp: new Date().toISOString(),
    });
  }

  return res.json({
    success: true,
    centerId: cleanCenterId,
    status: session.status,
    qr: session.qr,
    ready: session.isReady,
    service: "WhatsApp Multi-Tenant Automation Microservice",
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /init/:centerId
 * Calls initializeClient(centerId) if not already running.
 */
app.post("/init/:centerId", (req, res) => {
  const cleanCenterId = String(req.params.centerId || "")
    .trim()
    .toLowerCase();

  if (!cleanCenterId) {
    return res.status(400).json({
      success: false,
      error: "centerId is required",
    });
  }

  try {
    const session = initializeClient(cleanCenterId);
    return res.json({
      success: true,
      centerId: cleanCenterId,
      status: session.status,
      qr: session.qr,
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

  const session = sessions.get(cleanCenterId);

  if (!session) {
    return res.json({
      success: true,
      message: `No active session found for center: ${cleanCenterId}`,
    });
  }

  console.log(`[Center: ${cleanCenterId}] Logging out and clearing session...`);

  try {
    if (session.client) {
      await session.client.logout().catch((e) => {
        console.warn(`Logout error for ${cleanCenterId}:`, e.message);
      });
      await session.client.destroy().catch((e) => {
        console.warn(`Destroy error for ${cleanCenterId}:`, e.message);
      });
    }
  } catch (err) {
    console.warn(`Error during client logout/destroy for ${cleanCenterId}:`, err);
  } finally {
    sessions.delete(cleanCenterId);

    // Clean up local auth directory for this center so new QR code will be generated fresh
    try {
      const sessionDir = path.join(
        __dirname,
        ".wwebjs_auth",
        `session-${cleanCenterId}`
      );
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        console.log(`🗑️ Removed session cache directory for ${cleanCenterId}`);
      }
    } catch (cleanupErr) {
      console.warn("Could not delete session directory:", cleanupErr.message);
    }
  }

  return res.json({
    success: true,
    centerId: cleanCenterId,
    message: `WhatsApp session disconnected for center: ${cleanCenterId}. Ready for fresh pairing.`,
  });
});

// Auto-initialize existing centers if sessions directory exists
try {
  const authRoot = path.join(__dirname, ".wwebjs_auth");
  if (fs.existsSync(authRoot)) {
    const entries = fs.readdirSync(authRoot, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory() && ent.name.startsWith("session-")) {
        const id = ent.name.replace("session-", "");
        if (id) {
          console.log(`⚡ Auto-initializing saved session for center: ${id}`);
          initializeClient(id);
        }
      }
    }
  }
} catch (scanErr) {
  console.warn("Could not auto-scan saved sessions:", scanErr.message);
}

// Start Express Server
app.listen(PORT, HOST, () => {
  console.log(`🚀 Multi-Tenant WhatsApp Microservice listening on http://${HOST}:${PORT}`);
});

// Guard against unhandled library exceptions to keep server resilient
process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Unhandled Rejection in WhatsApp Server:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("⚠️ Uncaught Exception in WhatsApp Server:", err);
});
