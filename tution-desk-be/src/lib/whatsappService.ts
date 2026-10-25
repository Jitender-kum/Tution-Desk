/**
 * WhatsApp Multi-Tenant Notification Service
 * Connects to the standalone WhatsApp automation microservice (port 3005)
 * and scopes all dispatches to the specific center's WhatsApp session.
 *
 * Implements a strict fail-closed simulation guard.
 */

const WHATSAPP_SERVICE_URL =
  process.env.WHATSAPP_SERVICE_URL || "http://localhost:3005";

/**
 * Strict fail-closed guard for live WhatsApp dispatches.
 * Real outbound dispatch requires BOTH:
 * 1. WHATSAPP_MODE === "live" (explicitly configured)
 * 2. ENABLE_LIVE_WHATSAPP === "true" (explicit dual opt-in flag)
 *
 * Any missing, empty, invalid, or non-matching configuration strictly defaults to simulation.
 * NODE_ENV=production is NOT sufficient authorization for live dispatch.
 */
export function isLiveDispatchEnabled(): boolean {
  const mode = process.env.WHATSAPP_MODE?.trim().toLowerCase();
  const liveOptIn = process.env.ENABLE_LIVE_WHATSAPP?.trim().toLowerCase();
  return mode === "live" && liveOptIn === "true";
}

/**
 * Emits strictly sanitized metadata logs in simulation mode.
 * Never logs raw message text, full phone numbers, student/parent names, or tokens.
 */
function logSimulatedDispatch(
  eventType: string,
  centerId: string,
  phone: string,
  message: string
): void {
  const maskedPhone =
    phone && phone.length >= 4 ? `***${phone.slice(-4)}` : "****";
  console.log(
    `[WHATSAPP SIMULATION] Event: ${eventType} | Center: ${centerId} | Recipient: ${maskedPhone} | Length: ${message.length} chars`
  );
}

/**
 * Returns required internal headers for WhatsApp microservice dispatches.
 * Fails closed if WHATSAPP_INTERNAL_SECRET is missing.
 */
function getInternalHeaders(): Record<string, string> {
  const secret = process.env.WHATSAPP_INTERNAL_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error(
      "Configuration error: WHATSAPP_INTERNAL_SECRET is missing or empty"
    );
  }
  return {
    "Content-Type": "application/json",
    "x-internal-secret": secret.trim(),
  };
}

export interface SendWelcomeMessageResult {
  success: boolean;
  centerId: string;
  phone: string;
  magicLink: string;
  message: string;
  messageId?: string;
  simulated?: boolean;
}

/**
 * Sends an automated welcome message to the parent's WhatsApp upon new student admission.
 * Accepts the pre-formatted custom message directly.
 */
export async function sendWelcomeMessage(
  centerId: string,
  phone: string,
  message: string,
  studentId?: string
): Promise<SendWelcomeMessageResult> {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "http://localhost:3000";

  const magicLink = studentId ? `${appUrl}/p/${studentId}` : "";

  // Fail-closed simulation guard: zero network requests unless explicitly opted into live mode
  if (!isLiveDispatchEnabled()) {
    logSimulatedDispatch("welcome_message", centerId, phone, message);
    return {
      success: true,
      centerId,
      phone,
      magicLink,
      message,
      messageId: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      simulated: true,
    };
  }

  try {
    const response = await fetch(`${WHATSAPP_SERVICE_URL}/send-message`, {
      method: "POST",
      headers: getInternalHeaders(),
      body: JSON.stringify({
        centerId,
        phone,
        message,
      }),
    });

    const data = await response.json().catch(() => null);

    if (response.ok && data?.success) {
      console.log(
        `[WHATSAPP SERVICE] [Center: ${centerId}] Dispatched message! ID: ${data.messageId}`
      );
      return {
        success: true,
        centerId,
        phone,
        magicLink,
        message,
        messageId: data.messageId,
      };
    } else {
      console.warn(
        `[WHATSAPP SERVICE] [Center: ${centerId}] Microservice status ${response.status}: ${
          data?.error || "Client not connected or awaiting QR scan."
        }`
      );
    }
  } catch (err: unknown) {
    console.warn(
      `[WHATSAPP SERVICE OFFLINE] Microservice at ${WHATSAPP_SERVICE_URL} is unreachable. Falling back to simulated log.`,
      err instanceof Error ? err.message : err
    );
  }

  // Graceful offline fallback simulation log (sanitized)
  logSimulatedDispatch("welcome_message_offline_fallback", centerId, phone, message);

  return {
    success: true,
    centerId,
    phone,
    magicLink,
    message,
    simulated: true,
  };
}

export interface SendCustomMessageResult {
  success: boolean;
  simulated?: boolean;
  error?: string;
}

/**
 * Generic helper to send any custom WhatsApp message via microservice for a given center
 */
export async function sendCustomWhatsAppMessage(
  centerId: string,
  phone: string,
  message: string
): Promise<SendCustomMessageResult> {
  // Fail-closed simulation guard
  if (!isLiveDispatchEnabled()) {
    logSimulatedDispatch("custom_message", centerId, phone, message);
    return {
      success: true,
      simulated: true,
    };
  }

  try {
    const response = await fetch(`${WHATSAPP_SERVICE_URL}/send-message`, {
      method: "POST",
      headers: getInternalHeaders(),
      body: JSON.stringify({ centerId, phone, message }),
    });

    const data = await response.json().catch(() => null);
    return {
      success: response.ok && Boolean(data?.success),
      error: data?.error,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "WhatsApp microservice unreachable",
    };
  }
}

export interface SendFeeReminderResult {
  success: boolean;
  centerId: string;
  phone: string;
  message: string;
  messageId?: string;
  simulated?: boolean;
  error?: string;
}

/**
 * Sends an automated fee reminder to the parent's WhatsApp with due date, amount, and payment portal link.
 */
export async function sendFeeReminder(
  centerId: string,
  phone: string,
  studentName: string,
  amount: number | string,
  dueDate: string,
  magicLink?: string
): Promise<SendFeeReminderResult> {
  const portalText = magicLink
    ? `\n\n💳 Pay or view fee receipt online directly via your VIP Parent Portal:\n🔗 ${magicLink}`
    : "";

  const message = `Payment Reminder 🔔\n\nDear Parent, this is a friendly reminder that the tuition fee of ₹${Number(
    amount
  ).toLocaleString("en-IN")} for ${studentName} is due on ${dueDate}.${portalText}\n\nIf you have already paid, please ignore this reminder. Thank you!`;

  // Fail-closed simulation guard: zero network requests unless explicitly opted into live mode
  if (!isLiveDispatchEnabled()) {
    logSimulatedDispatch("fee_reminder", centerId, phone, message);
    return {
      success: true,
      centerId,
      phone,
      message,
      messageId: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      simulated: true,
    };
  }

  try {
    const response = await fetch(`${WHATSAPP_SERVICE_URL}/send-message`, {
      method: "POST",
      headers: getInternalHeaders(),
      body: JSON.stringify({ centerId, phone, message }),
    });

    const data = await response.json().catch(() => null);

    if (response.ok && data?.success) {
      console.log(
        `[WHATSAPP SERVICE] [Center: ${centerId}] Fee reminder dispatched! ID: ${data.messageId}`
      );
      return {
        success: true,
        centerId,
        phone,
        message,
        messageId: data.messageId,
      };
    } else {
      console.warn(
        `[WHATSAPP SERVICE] [Center: ${centerId}] Microservice returned status ${response.status}: ${
          data?.error || "Client not connected or awaiting QR scan."
        }`
      );
    }
  } catch (err: unknown) {
    console.warn(
      `[WHATSAPP SERVICE OFFLINE] Microservice at ${WHATSAPP_SERVICE_URL} unreachable for fee reminder. Falling back to simulated log.`,
      err instanceof Error ? err.message : err
    );
  }

  // Fallback simulation log (sanitized)
  logSimulatedDispatch("fee_reminder_offline_fallback", centerId, phone, message);

  return {
    success: true,
    centerId,
    phone,
    message,
    simulated: true,
  };
}

export interface SendTestResultResult {
  success: boolean;
  centerId: string;
  phone: string;
  message: string;
  messageId?: string;
  simulated?: boolean;
  error?: string;
}

/**
 * Sends a test marks alert to the parent's WhatsApp with score breakdown and student progress link.
 */
export async function sendTestResult(
  centerId: string,
  phone: string,
  studentName: string,
  testName: string,
  marks: number | string,
  maxMarks: number | string,
  magicLink?: string
): Promise<SendTestResultResult> {
  const numMarks = Number(marks);
  const numMax = Number(maxMarks);
  const percentage =
    !isNaN(numMarks) && !isNaN(numMax) && numMax > 0
      ? ` (${((numMarks / numMax) * 100).toFixed(1)}%)`
      : "";

  const portalText = magicLink
    ? `\n\n📊 Review detailed subject-wise insights & rank analytics on your VIP portal:\n🔗 ${magicLink}`
    : "";

  const message = `Test Result Announced 📝\n\nDear Parent, ${studentName}'s result for "${testName}" has been evaluated.\n\nScore: ${marks} / ${maxMarks}${percentage}${portalText}\n\nKeep encouraging ${studentName} for continuous improvement! 🌟`;

  // Fail-closed simulation guard: zero network requests unless explicitly opted into live mode
  if (!isLiveDispatchEnabled()) {
    logSimulatedDispatch("test_result", centerId, phone, message);
    return {
      success: true,
      centerId,
      phone,
      message,
      messageId: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      simulated: true,
    };
  }

  try {
    const response = await fetch(`${WHATSAPP_SERVICE_URL}/send-message`, {
      method: "POST",
      headers: getInternalHeaders(),
      body: JSON.stringify({ centerId, phone, message }),
    });

    const data = await response.json().catch(() => null);

    if (response.ok && data?.success) {
      console.log(
        `[WHATSAPP SERVICE] [Center: ${centerId}] Test result dispatched! ID: ${data.messageId}`
      );
      return {
        success: true,
        centerId,
        phone,
        message,
        messageId: data.messageId,
      };
    } else {
      console.warn(
        `[WHATSAPP SERVICE] [Center: ${centerId}] Microservice returned status ${response.status}: ${
          data?.error || "Client not connected or awaiting QR scan."
        }`
      );
    }
  } catch (err: unknown) {
    console.warn(
      `[WHATSAPP SERVICE OFFLINE] Microservice at ${WHATSAPP_SERVICE_URL} unreachable for test result. Falling back to simulated log.`,
      err instanceof Error ? err.message : err
    );
  }

  // Fallback simulation log (sanitized)
  logSimulatedDispatch("test_result_offline_fallback", centerId, phone, message);

  return {
    success: true,
    centerId,
    phone,
    message,
    simulated: true,
  };
}
