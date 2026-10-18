import { database, parseJson } from "./database.js";
import { orderEmailsEnabled, sendEmail } from "./email.js";

export type OrderEmailKind = "placed" | "ready_for_pickup" | "out_for_delivery" | "delivered" | "rejected" | "cancelled";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);
}

const naira = (minor: number) => `₦${Math.round(minor / 100).toLocaleString("en-NG")}`;

function frontendUrl(path: string): string {
  return new URL(path, process.env.AUTH_FRONTEND_URL ?? "https://theivypizza.com").toString();
}

interface EmailOrder {
  order_number: string;
  fulfilment_mode: string;
  payment_method: string;
  payment_status: string;
  total_minor: number;
  delivery_snapshot: unknown;
  guest_contact: unknown;
  customer_email: string | null;
  status_reason: string | null;
}

/** Brand-consistent, mobile-friendly email body: a green header, short copy, one button. */
function layout(title: string, paragraphs: string[], button: { label: string; href: string } | null, footer: string): string {
  return `<div style="margin:0;padding:24px 12px;background:#f7f3ea;font-family:Arial,Helvetica,sans-serif;color:#122019">
  <div style="max-width:520px;margin:0 auto;background:#fffdf8;border-radius:10px;overflow:hidden;border:1px solid #e6dfcf">
    <div style="padding:18px 24px;background:#103c2a;color:#f7f3ea;font-size:18px;letter-spacing:3px">THE IVY <span style="color:#d5a543">PIZZA</span></div>
    <div style="padding:24px">
      <h1 style="margin:0 0 12px;font-size:24px;font-weight:normal;color:#103c2a">${escapeHtml(title)}</h1>
      ${paragraphs.map((text) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55">${text}</p>`).join("")}
      ${button ? `<p style="margin:20px 0 4px"><a href="${escapeHtml(button.href)}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#d5a543;color:#122019;font-weight:bold;text-decoration:none">${escapeHtml(button.label)}</a></p>` : ""}
    </div>
    <div style="padding:14px 24px;border-top:1px solid #eee5d3;font-size:12px;color:#526057">${footer}</div>
  </div></div>`;
}

/**
 * Sends a customer email about an order, if we know their address and an orders mailbox is configured.
 * Never throws: a failed email must not undo or block an order change.
 */
export async function sendOrderEmail(orderId: string, kind: OrderEmailKind): Promise<void> {
  if (!orderEmailsEnabled()) return;
  try {
    const { rows: [order] } = await database.query<EmailOrder>(
      `SELECT o.order_number, o.fulfilment_mode, o.payment_method, o.payment_status, o.total_minor, o.delivery_snapshot,
              o.guest_contact, u.email AS customer_email,
              (SELECT reason FROM order_status_events e WHERE e.order_id = o.id ORDER BY e.created_at DESC LIMIT 1) AS status_reason
       FROM orders o LEFT JOIN users u ON u.id = o.customer_id WHERE o.id = ?`,
      [orderId],
    );
    if (!order) return;
    const snapshot = parseJson<{ recipientName?: string; email?: string; address?: string; store?: string }>(order.delivery_snapshot) ?? {};
    const guest = parseJson<{ name?: string; email?: string | null }>(order.guest_contact);
    const to = order.customer_email ?? guest?.email ?? snapshot.email ?? null;
    if (!to) return;
    const firstName = String(snapshot.recipientName ?? guest?.name ?? "").split(/\s+/)[0] || "there";
    const track = { label: "Track your order", href: frontendUrl(`/track/${order.order_number}`) };
    const footer = `Order ${escapeHtml(order.order_number)} · Questions? Visit <a href="${escapeHtml(frontendUrl("/help"))}" style="color:#103c2a">our help page</a>.`;
    const pickup = order.fulfilment_mode === "pickup";
    const refund = order.payment_status === "refund_pending" ? " We've started a refund of the amount you paid." : " You haven't been charged.";

    const content: Record<OrderEmailKind, { subject: string; title: string; body: string[]; button: typeof track | null }> = {
      placed: {
        subject: `We've got your order ${order.order_number}`,
        title: `Thanks, ${firstName}. Your order is in.`,
        body: [
          `Order <strong>${escapeHtml(order.order_number)}</strong> · ${naira(order.total_minor)}.`,
          order.payment_method === "transfer"
            ? "Transfer the total within 30 minutes using your order number as the reference, and we'll start cooking once it lands."
            : pickup ? "We'll let you know when it's ready to collect." : `We'll deliver to ${escapeHtml(snapshot.address ?? "your address")}.`,
        ],
        button: track,
      },
      ready_for_pickup: {
        subject: `Your order ${order.order_number} is ready to collect`,
        title: "Ready at the counter",
        body: [`Come to ${escapeHtml(snapshot.store ?? "the kitchen")} and give your order number, <strong>${escapeHtml(order.order_number)}</strong>.`],
        button: track,
      },
      out_for_delivery: {
        subject: `Your order ${order.order_number} is on its way`,
        title: "Your rider is on the way",
        body: [order.payment_method === "on_delivery" ? `Please have ${naira(order.total_minor)} ready in cash, or pay by card on the rider's POS.` : "Your rider will call when they arrive."],
        button: track,
      },
      delivered: {
        subject: `Enjoy your Ivy Pizza, ${firstName}`,
        title: pickup ? "Thanks for collecting" : "Delivered. Enjoy!",
        body: ["How was it? A quick rating helps the kitchen get every order right."],
        button: { label: "Rate your order", href: frontendUrl(`/track/${order.order_number}`) },
      },
      rejected: {
        subject: `We couldn't take your order ${order.order_number}`,
        title: "Sorry, we couldn't take this order",
        body: [`${order.status_reason ? `${escapeHtml(order.status_reason)}.` : "The kitchen couldn't take this order."}${refund}`],
        button: null,
      },
      cancelled: {
        subject: `Your order ${order.order_number} was cancelled`,
        title: "Your order was cancelled",
        body: [`${order.status_reason ? `${escapeHtml(order.status_reason)}.` : ""}${refund}`],
        button: null,
      },
    };
    const email = content[kind];
    await sendEmail("orders", {
      to,
      subject: email.subject,
      text: `${email.title}\n\n${email.body.map((text) => text.replace(/<[^>]+>/g, "")).join("\n\n")}${email.button ? `\n\n${email.button.label}: ${email.button.href}` : ""}`,
      html: layout(email.title, email.body, email.button, footer),
    });
  } catch (error) {
    console.error(`Order email (${kind}) failed:`, error instanceof Error ? error.message : error);
  }
}

/** Fire and forget after a transaction commits. */
export function queueOrderEmail(orderId: string, kind: OrderEmailKind): void {
  void sendOrderEmail(orderId, kind);
}
