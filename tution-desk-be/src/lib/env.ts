/**
 * TuitionDesk Production Environment & Configuration Validator
 * Validates that all mandatory environment variables, security secrets,
 * and fail-closed guards are properly configured before production launch.
 */

export interface EnvValidationIssue {
  variable: string;
  severity: "CRITICAL" | "WARNING";
  message: string;
}

export interface EnvValidationResult {
  valid: boolean;
  isProduction: boolean;
  issues: EnvValidationIssue[];
  criticalCount: number;
  warningCount: number;
  configSummary: Record<string, string>;
}

export function validateEnvironment(env: Record<string, string | undefined> = process.env): EnvValidationResult {
  const issues: EnvValidationIssue[] = [];
  const isProduction = env.NODE_ENV === "production";

  // Helper for masking secrets
  const maskSecret = (val?: string): string => {
    if (!val) return "[NOT SET]";
    if (val.length <= 8) return "***";
    return `${val.slice(0, 4)}...${val.slice(-4)}`;
  };

  // 1. MONGODB_URI
  const mongoUri = env.MONGODB_URI?.trim();
  if (!mongoUri) {
    issues.push({
      variable: "MONGODB_URI",
      severity: "CRITICAL",
      message: "Database connection string is missing.",
    });
  } else {
    if (isProduction && (mongoUri.includes("localhost") || mongoUri.includes("127.0.0.1"))) {
      issues.push({
        variable: "MONGODB_URI",
        severity: "CRITICAL",
        message: "Production MONGODB_URI points to localhost/127.0.0.1.",
      });
    }
    if (mongoUri.includes("atlasAdmin")) {
      issues.push({
        variable: "MONGODB_URI",
        severity: "WARNING",
        message: "MONGODB_URI uses atlasAdmin credentials; runtime should use least-privilege readWrite role.",
      });
    }
  }

  // 2. JWT_SECRET
  const jwtSecret = env.JWT_SECRET?.trim();
  if (!jwtSecret) {
    issues.push({
      variable: "JWT_SECRET",
      severity: "CRITICAL",
      message: "JWT_SECRET is missing. Authentication cannot function.",
    });
  } else if (jwtSecret.length < 32) {
    issues.push({
      variable: "JWT_SECRET",
      severity: isProduction ? "CRITICAL" : "WARNING",
      message: `JWT_SECRET length is ${jwtSecret.length} chars (minimum 32 characters required for secure HMAC-SHA256).`,
    });
  }

  // 3. YOUPI_WEBHOOK_SECRET
  const youpiSecret = env.YOUPI_WEBHOOK_SECRET?.trim();
  if (!youpiSecret) {
    issues.push({
      variable: "YOUPI_WEBHOOK_SECRET",
      severity: "CRITICAL",
      message: "YOUPI_WEBHOOK_SECRET is missing. Payment gateway webhooks will fail closed with 500.",
    });
  } else if (youpiSecret.length < 8) {
    issues.push({
      variable: "YOUPI_WEBHOOK_SECRET",
      severity: "WARNING",
      message: "YOUPI_WEBHOOK_SECRET is shorter than 8 characters.",
    });
  }

  // 4. CRON_SECRET
  const cronSecret = env.CRON_SECRET?.trim();
  if (!cronSecret) {
    issues.push({
      variable: "CRON_SECRET",
      severity: "CRITICAL",
      message: "CRON_SECRET is missing. Automated recurring fee generation cron will fail closed with 500.",
    });
  } else if (cronSecret.length < 16) {
    issues.push({
      variable: "CRON_SECRET",
      severity: "WARNING",
      message: "CRON_SECRET is shorter than 16 characters.",
    });
  }

  // 5. WHATSAPP_INTERNAL_SECRET
  const waInternalSecret = env.WHATSAPP_INTERNAL_SECRET?.trim();
  if (!waInternalSecret) {
    issues.push({
      variable: "WHATSAPP_INTERNAL_SECRET",
      severity: "CRITICAL",
      message: "WHATSAPP_INTERNAL_SECRET is missing. Outbound notifications cannot reach the microservice.",
    });
  } else if (waInternalSecret.length < 16) {
    issues.push({
      variable: "WHATSAPP_INTERNAL_SECRET",
      severity: "WARNING",
      message: "WHATSAPP_INTERNAL_SECRET is shorter than 16 characters.",
    });
  }

  // 6. Public APP_URL / NEXT_PUBLIC_APP_URL
  const appUrl = (env.NEXT_PUBLIC_APP_URL || env.APP_URL)?.trim();
  if (!appUrl) {
    issues.push({
      variable: "APP_URL",
      severity: isProduction ? "CRITICAL" : "WARNING",
      message: "APP_URL / NEXT_PUBLIC_APP_URL is missing. Magic links and receipt URLs may default to localhost:3000.",
    });
  } else if (isProduction && (appUrl.includes("localhost") || appUrl.includes("127.0.0.1"))) {
    issues.push({
      variable: "APP_URL",
      severity: "CRITICAL",
      message: `Production APP_URL is configured as "${appUrl}". Must be a valid public HTTPS origin.`,
    });
  }

  // 7. WhatsApp Live Safety Guards
  const waMode = env.WHATSAPP_MODE?.trim().toLowerCase();
  const liveOptIn = env.ENABLE_LIVE_WHATSAPP?.trim().toLowerCase();
  if (waMode === "live" && liveOptIn !== "true") {
    issues.push({
      variable: "ENABLE_LIVE_WHATSAPP",
      severity: "WARNING",
      message: "WHATSAPP_MODE is set to 'live' but ENABLE_LIVE_WHATSAPP is not 'true'; system will safely remain in simulation.",
    });
  }

  // 8. ALLOWED_ORIGINS in production
  const allowedOrigins = env.ALLOWED_ORIGINS?.trim();
  if (isProduction && allowedOrigins && allowedOrigins.includes("localhost")) {
    issues.push({
      variable: "ALLOWED_ORIGINS",
      severity: "WARNING",
      message: "ALLOWED_ORIGINS includes 'localhost' in a production environment.",
    });
  }

  const criticalCount = issues.filter((i) => i.severity === "CRITICAL").length;
  const warningCount = issues.filter((i) => i.severity === "WARNING").length;

  return {
    valid: criticalCount === 0,
    isProduction,
    issues,
    criticalCount,
    warningCount,
    configSummary: {
      NODE_ENV: env.NODE_ENV || "development",
      MONGODB_URI: mongoUri ? (mongoUri.includes("@") ? `mongodb+srv://...${mongoUri.split("@")[1].split("?")[0]}` : "[CONFIGURED]") : "[MISSING]",
      JWT_SECRET: maskSecret(jwtSecret),
      YOUPI_WEBHOOK_SECRET: maskSecret(youpiSecret),
      CRON_SECRET: maskSecret(cronSecret),
      WHATSAPP_INTERNAL_SECRET: maskSecret(waInternalSecret),
      APP_URL: appUrl || "[NOT SET - FALLS BACK TO LOCALHOST]",
      WHATSAPP_MODE: waMode || "simulation (default)",
      ENABLE_LIVE_WHATSAPP: liveOptIn || "false (default)",
    },
  };
}

export default validateEnvironment;
