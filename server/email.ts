import nodemailer, { type Transporter } from "nodemailer";
import { database } from "./database.js";

// Each kind of email is sent from its own theivypizza.com mailbox, logged in with that
// mailbox's own credentials so the From address always matches the sending account.
export const mailboxes = ["customers", "staff", "orders", "solutions"] as const;
export type Mailbox = (typeof mailboxes)[number];

const defaultAddresses: Record<Mailbox, string> = {
  customers: "customers@theivypizza.com",
  staff: "staff@theivypizza.com",
  orders: "orders@theivypizza.com",
  solutions: "solutions@theivypizza.com",
};

// Mailboxes the app sends from today. The others are configured when their emails are added.
const requiredMailboxes: Mailbox[] = ["customers", "staff"];

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface SentTestEmail extends Email {
  mailbox: Mailbox;
  from: string;
}

const testEmails: SentTestEmail[] = [];
const emailProvider = (process.env.EMAIL_PROVIDER ?? "smtp").trim().toLowerCase();
const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT ?? 465);
const smtpSecure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : smtpPort === 465;

function mailboxSetting(mailbox: Mailbox, name: "USER" | "PASSWORD" | "FROM"): string | undefined {
  return process.env[`SMTP_${mailbox.toUpperCase()}_${name}`]?.trim() || undefined;
}

function senderFor(mailbox: Mailbox): string {
  return mailboxSetting(mailbox, "FROM")
    ?? `The Ivy Pizza <${mailboxSetting(mailbox, "USER") ?? defaultAddresses[mailbox]}>`;
}

const transporters = new Map<Mailbox, Transporter>();

function transporterFor(mailbox: Mailbox): Transporter {
  const existing = transporters.get(mailbox);
  if (existing) return existing;
  const user = mailboxSetting(mailbox, "USER");
  const pass = mailboxSetting(mailbox, "PASSWORD");
  if (!smtpHost || !user || !pass) {
    const prefix = `SMTP_${mailbox.toUpperCase()}`;
    throw new Error(`The ${mailbox} mailbox is not configured: set SMTP_HOST, ${prefix}_USER and ${prefix}_PASSWORD`);
  }
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    // For plaintext SMTP ports (such as 26), fail instead of sending
    // credentials or mail if the server does not offer STARTTLS.
    ...(smtpSecure ? {} : { requireTLS: true }),
    auth: { user, pass },
  });
  transporters.set(mailbox, transporter);
  return transporter;
}

// Fail at startup rather than on a customer's first signup.
export function checkEmailConfiguration(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (emailProvider === "resend") {
    if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is required when EMAIL_PROVIDER=resend");
    return;
  }
  if (emailProvider !== "smtp") throw new Error(`Unsupported EMAIL_PROVIDER: ${emailProvider}`);
  for (const mailbox of requiredMailboxes) transporterFor(mailbox);
}

async function sendWithResend(from: string, email: Email): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is required when EMAIL_PROVIDER=resend");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, ...email }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Resend email request failed (${response.status}): ${detail.slice(0, 1000)}`);
  }
}

export async function sendEmail(mailbox: Mailbox, email: Email): Promise<void> {
  const from = senderFor(mailbox);
  if (process.env.NODE_ENV === "test") {
    testEmails.push({ ...email, mailbox, from });
    return;
  }
  if (emailProvider === "resend") {
    await sendWithResend(from, email);
    return;
  }
  if (emailProvider !== "smtp") throw new Error(`Unsupported EMAIL_PROVIDER: ${emailProvider}`);
  await transporterFor(mailbox).sendMail({ from, ...email });
}

// Account emails for staff come from the staff mailbox; everyone else is a customer.
export async function accountMailboxFor(authUserId: string): Promise<Mailbox> {
  const { rowCount } = await database.query(
    `SELECT 1 FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE u.better_auth_user_id = ? AND r.name <> 'customer'
     LIMIT 1`,
    [authUserId],
  );
  return rowCount ? "staff" : "customers";
}

export function takeTestEmail(): SentTestEmail | undefined {
  return testEmails.shift();
}
