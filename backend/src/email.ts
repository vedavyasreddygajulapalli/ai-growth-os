import { fail } from "./contracts";
export interface AccountEmail { to: string; subject: string; text: string; key: string }
type Transport = (message: AccountEmail) => Promise<void>;
let testTransport: Transport | undefined;
// Only tests can install an in-memory sink. Production has no log/console fallback.
export function setTestEmailTransport(transport?: Transport) {
  if (process.env.NODE_ENV !== "test") throw new Error("Test transport unavailable");
  testTransport = transport;
}
export function assertEmailConfigured() {
  if (process.env.NODE_ENV === "test" && testTransport) return;
  const origin = process.env.PUBLIC_APP_URL;
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !origin)
    fail(503, "EMAIL_UNAVAILABLE", "Email service is not configured. Contact your administrator.");
  try {
    const url = new URL(origin!);
    if (url.username || url.password || url.search || url.hash ||
        (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.hostname === "localhost")))
      throw new Error();
  } catch { fail(503, "EMAIL_UNAVAILABLE", "Email service configuration is invalid."); }
}
export async function sendAccountEmail(message: AccountEmail) {
  assertEmailConfigured();
  if (process.env.NODE_ENV === "test" && testTransport) return testTransport(message);
  try {
    const result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": message.key,
      },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text }),
    });
    if (!result.ok) throw new Error("Provider rejected email");
  } catch { fail(503, "EMAIL_DELIVERY_FAILED", "Email could not be sent. Please try again later."); }
}
