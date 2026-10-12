import nodemailer from "nodemailer";
import { fail } from "./contracts";
export interface AccountEmail { to: string; subject: string; text: string; key: string }
type Transport = (message: AccountEmail) => Promise<void>;
let testTransport: Transport | undefined;
// Only tests can install an in-memory sink. Production has no log/console fallback.
export function setTestEmailTransport(transport?: Transport) {
  if (process.env.NODE_ENV !== "test") throw new Error("Test transport unavailable");
  testTransport = transport;
}
export function emailTransport(env: NodeJS.ProcessEnv = process.env) {
  return env.EMAIL_TRANSPORT || (env.SMTP_HOST ? "smtp" : env.RESEND_API_KEY ? "resend" : "none");
}
export function smtpOptions(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.SMTP_PORT || 587);
  return {
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE === "true" || port === 465,
    requireTLS: !(env.SMTP_SECURE === "true" || port === 465),
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  };
}
export function emailConfigured(env: NodeJS.ProcessEnv = process.env) {
  if (!env.EMAIL_FROM?.trim() || !env.PUBLIC_APP_URL) return false;
  const provider = emailTransport(env);
  if (provider === "smtp")
    return !!(env.SMTP_HOST?.trim() && env.SMTP_USER?.trim() && env.SMTP_PASS?.trim() && /^\d+$/.test(env.SMTP_PORT || "587"));
  return provider === "resend" && !!env.RESEND_API_KEY?.trim();
}
export function assertEmailConfigured() {
  if (process.env.NODE_ENV === "test" && testTransport) return;
  const origin = process.env.PUBLIC_APP_URL;
  if (!emailConfigured())
    fail(503, "EMAIL_UNAVAILABLE", "Email service is not configured. Contact your administrator.");
  try {
    const url = new URL(origin!);
    if (url.username || url.password || url.search || url.hash ||
        (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.hostname === "localhost")))
      throw new Error();
  } catch { fail(503, "EMAIL_UNAVAILABLE", "Email service configuration is invalid."); }
}
function classifyProviderMessage(message: unknown) {
  if (typeof message !== "string") return "provider_rejected_request";
  const normalized = message.toLowerCase();
  if (normalized.includes("from") && (normalized.includes("invalid") || normalized.includes("format"))) return "sender_address_invalid";
  if (normalized.includes("own email address") || normalized.includes("only send testing emails")) return "recipient_not_allowed_in_test_mode";
  if (normalized.includes("domain") && normalized.includes("verified")) return "sender_domain_not_verified";
  if (normalized.includes("api key") || normalized.includes("unauthorized") || normalized.includes("auth")) return "credentials_rejected";
  if (normalized.includes("suppressed")) return "recipient_suppressed";
  return "provider_rejected_request";
}
async function sendSmtp(message: AccountEmail) {
  const transport = nodemailer.createTransport(smtpOptions());
  const result = await transport.sendMail({
    from: process.env.EMAIL_FROM!.trim(),
    to: message.to,
    subject: message.subject,
    text: message.text,
    headers: { "X-AI-Growth-Message-Key": message.key },
  });
  if (!result.accepted.includes(message.to) || result.rejected.length)
    throw new Error("smtp_recipient_rejected");
  transport.close();
}
async function sendResend(message: AccountEmail) {
  const result = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`, "Content-Type": "application/json", "Idempotency-Key": message.key },
    body: JSON.stringify({ from: process.env.EMAIL_FROM!.trim(), to: [message.to], subject: message.subject, text: message.text }),
  });
  if (!result.ok) {
    const raw: unknown = await result.json().catch(() => null);
    const body = raw && typeof raw === "object" ? raw as { name?: unknown; message?: unknown } : {};
    const providerError = typeof body.name === "string" && /^[a-z0-9_-]{1,48}$/i.test(body.name) ? body.name : "unknown";
    console.error(JSON.stringify({ code: "EMAIL_PROVIDER_REJECTED", provider: "resend", status: result.status, providerError, reason: classifyProviderMessage(body.message) }));
    fail(503, "EMAIL_DELIVERY_FAILED", "Email could not be sent. Please try again later.");
  }
}
export async function sendAccountEmail(message: AccountEmail) {
  assertEmailConfigured();
  if (process.env.NODE_ENV === "test" && testTransport) return testTransport(message);
  try {
    if (emailTransport() === "smtp") await sendSmtp(message);
    else await sendResend(message);
  } catch (error) {
    if (error instanceof Error && error.message === "Email could not be sent. Please try again later.") throw error;
    const reason = error instanceof Error && error.name === "TimeoutError" ? "provider_timeout" : classifyProviderMessage(error instanceof Error ? error.message : undefined);
    console.error(JSON.stringify({ code: "EMAIL_PROVIDER_FAILURE", provider: emailTransport(), reason }));
    fail(503, "EMAIL_DELIVERY_FAILED", "Email could not be sent. Please try again later.");
  }
}
