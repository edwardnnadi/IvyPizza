import { betterAuth } from "better-auth";
import { pool } from "./database.js";
import { accountMailboxFor, checkEmailConfiguration, sendEmail } from "./email.js";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);
}

const production = process.env.NODE_ENV === "production";
checkEmailConfiguration();

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
      await sendEmail(await accountMailboxFor(user.id), {
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
      await sendEmail(await accountMailboxFor(user.id), {
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

