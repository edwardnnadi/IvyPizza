import { betterAuth } from "better-auth";
import nodemailer from "nodemailer";
import { pool } from "./database.js";

interface AuthEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);
}

const testEmails: AuthEmail[] = [];
const production = process.env.NODE_ENV === "production";
const emailProvider = (process.env.EMAIL_PROVIDER ?? "smtp").trim().toLowerCase();
const smtpPort = Number(process.env.SMTP_PORT ?? 465);
const smtpHost = process.env.SMTP_HOST;
const smtpUser = process.env.SMTP_USER;
const smtpPassword = process.env.SMTP_PASSWORD;
const smtpFrom = process.env.SMTP_FROM ?? "The Ivy Pizza <orders@theivypizza.com>";
const transporter = smtpHost && smtpUser && smtpPassword
  ? nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : smtpPort === 465,
      // For plaintext SMTP ports (such as 26), fail instead of sending
      // credentials or mail if the server does not offer STARTTLS.
      ...(process.env.SMTP_SECURE === "true" ? {} : { requireTLS: true }),
      auth: { user: smtpUser, pass: smtpPassword },
    })
  : null;

async function sendWithResend(email: AuthEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is required when EMAIL_PROVIDER=resend");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: smtpFrom, ...email }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Resend email request failed (${response.status}): ${detail.slice(0, 1000)}`);
  }
}

async function sendAuthEmail(email: AuthEmail): Promise<void> {
  if (process.env.NODE_ENV === "test") {
    testEmails.push(email);
    return;
  }
  if (emailProvider === "resend") {
    await sendWithResend(email);
    return;
  }
  if (emailProvider !== "smtp") throw new Error(`Unsupported EMAIL_PROVIDER: ${emailProvider}`);
  if (!transporter) throw new Error("Email delivery is not configured: configure SMTP_HOST, SMTP_USER, and SMTP_PASSWORD");
  await transporter.sendMail({ from: smtpFrom, ...email });
}

const trustedOriginSetting = process.env.AUTH_TRUSTED_ORIGINS;
if (production && !trustedOriginSetting) throw new Error("AUTH_TRUSTED_ORIGINS is required in production");
const trustedOrigins = (trustedOriginSetting ?? [
  "https://theivypizza.com",
  "https://www.theivypizza.com",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
].join(","))
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const cookieDomain = process.env.AUTH_COOKIE_DOMAIN;
const localSecret = "ivy-pizza-local-only-secret-change-before-production-9e12";
const secret = process.env.BETTER_AUTH_SECRET ?? (!production ? localSecret : "");
if (!secret) throw new Error("BETTER_AUTH_SECRET is required in production");
const baseURL = process.env.BETTER_AUTH_URL ?? (!production ? "http://127.0.0.1:3001" : "");
if (!baseURL) throw new Error("BETTER_AUTH_URL is required in production");
if (production && !cookieDomain) throw new Error("AUTH_COOKIE_DOMAIN is required for the production website and API origins");

export const auth = betterAuth({
  appName: "The Ivy Pizza",
  baseURL,
  basePath: "/api/auth",
  secret,
  database: pool,
  trustedOrigins,
  advanced: {
    useSecureCookies: production,
    ...(cookieDomain ? {
      crossSubDomainCookies: { enabled: true, domain: cookieDomain },
    } : {}),
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    sendResetPassword: async ({ user, token }) => {
      const resetUrl = new URL("/", process.env.AUTH_FRONTEND_URL ?? "https://theivypizza.com");
      resetUrl.searchParams.set("resetToken", token);
      const link = resetUrl.toString();
      await sendAuthEmail({
        to: user.email,
        subject: "Reset your Ivy Pizza password",
        text: `Use this link to reset your password: ${link}\n\nIf you did not request this, you can ignore this email.`,
        html: `<p>Use this link to reset your password:</p><p><a href="${escapeHtml(link)}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendAuthEmail({
        to: user.email,
        subject: "Confirm your Ivy Pizza account",
        text: `Confirm your email address to finish creating your Ivy Pizza account: ${url}\n\nIf you did not create this account, you can ignore this email.`,
        html: `<p>Confirm your email address to finish creating your Ivy Pizza account:</p><p><a href="${escapeHtml(url)}">Confirm email</a></p><p>If you did not create this account, you can ignore this email.</p>`,
      });
    },
  },
});

export async function runBetterAuthMigrations(): Promise<void> {
  const context = await auth.$context;
  await context.runMigrations();
}

export function takeTestEmail(): AuthEmail | undefined {
  return testEmails.shift();
}
