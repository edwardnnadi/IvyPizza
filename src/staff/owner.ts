import { escapeHtml, naira, startStaffScreen, type StaffContext } from "./shell.js";

interface Report {
  days: number;
  summary: {
    orders: number; revenueMinor: number; averageOrderMinor: number; discountsMinor: number; delivery: number; pickup: number;
    inProgress: number; rejected: number; cancelled: number; averagePrepMinutes: number | null; averageDeliveryMinutes: number | null;
    lateOrders: number; refunds: number; refundsMinor: number; averageRating: number | null; ratings: number;
  };
  byDay: Array<{ date: string; orders: number; revenueMinor: number }>;
  byHour: Array<{ hour: number; orders: number }>;
  topItems: Array<{ name: string; quantity: number; revenueMinor: number }>;
  topAreas: Array<{ name: string; orders: number; revenueMinor: number }>;
  recentReviews: Array<{ orderNumber: string; rating: number; body: string; createdAt: string }>;
}

interface SupportRequest { id: string; orderNumber: string | null; name: string; contact: string; topic: string; message: string; createdAt: string }

/** Horizontal bars with the values written out, so the numbers never depend on reading the bar. */
function bars(rows: Array<{ label: string; value: number; display: string }>, label: string): string {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return `<div class="owner-bars" role="list" aria-label="${escapeHtml(label)}">${rows.map((row) => `
    <div class="owner-bar" role="listitem"><span class="owner-bar-label">${escapeHtml(row.label)}</span><span class="owner-bar-track"><i style="width:${Math.round((row.value / max) * 100)}%"></i></span><span class="owner-bar-value">${escapeHtml(row.display)}</span></div>`).join("")}</div>`;
}

const tile = (label: string, value: string, note = "") =>
  `<div class="owner-tile"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ""}</div>`;

function startOwner(context: StaffContext): void {
  let days = 1;
  const root = document.createElement("div");
  context.board.className = "owner-board";
  context.board.append(root);

  const render = (report: Report, requests: SupportRequest[]): void => {
    const s = report.summary;
    const dayFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    const busiest = report.byHour.filter((row) => row.orders > 0);
    root.innerHTML = `
      <div class="owner-head">
        <div><div class="eyebrow dark">The Ivy Pizza</div><h1>Sales and service</h1></div>
        <div class="owner-range" role="group" aria-label="Period">${[1, 7, 30].map((value) => `<button type="button" aria-pressed="${value === days}" data-days="${value}">${value === 1 ? "Today" : `${value} days`}</button>`).join("")}</div>
      </div>
      <div class="owner-tiles">
        ${tile("Revenue", naira(s.revenueMinor), `${s.orders} orders`)}
        ${tile("Average order", naira(s.averageOrderMinor))}
        ${tile("Delivery / pickup", `${s.delivery} / ${s.pickup}`)}
        ${tile("In progress now", String(s.inProgress))}
        ${tile("Avg prep time", s.averagePrepMinutes === null ? "—" : `${s.averagePrepMinutes} min`, "accepted → ready")}
        ${tile("Avg delivery time", s.averageDeliveryMinutes === null ? "—" : `${s.averageDeliveryMinutes} min`, "out → delivered")}
        ${tile("Late deliveries", String(s.lateOrders), "over ETA + 10 min")}
        ${tile("Rating", s.averageRating === null ? "—" : `${s.averageRating} ★`, `${s.ratings} reviews`)}
        ${tile("Rejected / cancelled", `${s.rejected} / ${s.cancelled}`)}
        ${tile("Refunds", String(s.refunds), s.refunds ? naira(s.refundsMinor) : "")}
        ${tile("Discounts given", naira(s.discountsMinor))}
      </div>
      <div class="owner-grid">
        ${report.days > 1 ? `<section class="hr-card"><h2>Revenue by day</h2>${bars(report.byDay.map((row) => ({ label: dayFormat.format(new Date(`${row.date}T12:00:00Z`)), value: row.revenueMinor, display: `${naira(row.revenueMinor)} · ${row.orders}` })), "Revenue by day")}</section>` : ""}
        <section class="hr-card"><h2>Orders by hour</h2>${busiest.length ? bars(busiest.map((row) => ({ label: `${String(row.hour).padStart(2, "0")}:00`, value: row.orders, display: String(row.orders) })), "Orders by hour") : `<p class="hr-empty">No orders yet.</p>`}</section>
        <section class="hr-card"><h2>Top items</h2>${report.topItems.length ? bars(report.topItems.map((row) => ({ label: row.name, value: row.revenueMinor, display: `${naira(row.revenueMinor)} · ${row.quantity} sold` })), "Top items") : `<p class="hr-empty">No sales yet.</p>`}</section>
        <section class="hr-card"><h2>Top areas</h2>${report.topAreas.length ? bars(report.topAreas.map((row) => ({ label: row.name, value: row.orders, display: `${row.orders} · ${naira(row.revenueMinor)}` })), "Top areas") : `<p class="hr-empty">No orders yet.</p>`}</section>
        <section class="hr-card"><h2>Recent reviews</h2>${report.recentReviews.length ? `<ul class="owner-reviews">${report.recentReviews.map((review) => `<li><strong>${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</strong> <span>${escapeHtml(review.orderNumber)}</span><p>${escapeHtml(review.body || "No comment")}</p></li>`).join("")}</ul>` : `<p class="hr-empty">No reviews in this period.</p>`}</section>
        <section class="hr-card"><h2>Open help requests <span class="owner-count">${requests.length}</span></h2>${requests.length ? `<ul class="owner-reviews">${requests.map((request) => `<li><strong>${escapeHtml(request.name)}</strong> <span>${escapeHtml(request.topic)}${request.orderNumber ? ` · ${escapeHtml(request.orderNumber)}` : ""}</span><p>${escapeHtml(request.message)}</p><p class="owner-contact">${escapeHtml(request.contact)} · <button type="button" class="link-button" data-close="${request.id}">Mark handled</button></p></li>`).join("")}</ul>` : `<p class="hr-empty">Nothing waiting.</p>`}</section>
      </div>`;
  };

  const load = async (): Promise<void> => {
    try {
      const [reportResponse, supportResponse] = await Promise.all([context.request(`/api/owner/report?days=${days}`), context.request("/api/support/requests")]);
      if (!reportResponse.ok) throw new Error("Could not load the report.");
      const report = await reportResponse.json() as Report;
      const requests = supportResponse.ok ? (await supportResponse.json() as { requests: SupportRequest[] }).requests : [];
      render(report, requests);
      context.setMessage(`Updated ${new Date().toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}`);
    } catch (error) {
      context.setMessage(error instanceof Error ? error.message : "Could not load the report.", "error");
    }
  };

  root.addEventListener("click", async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button) return;
    if (button.dataset.days) {
      days = Number(button.dataset.days);
      await load();
    }
    if (button.dataset.close) {
      await context.request(`/api/support/requests/${button.dataset.close}/close`, { method: "PATCH" });
      await load();
    }
  });
  context.addTopButton("Refresh", () => void load());
  void load();
  context.every(60_000, () => void load());
}

export function startOwnerScreen(app: HTMLElement): void {
  startStaffScreen(app, {
    title: "Owner dashboard",
    eyebrow: "Reports",
    intro: "Sign in with an owner or manager account to see sales, service times and reviews.",
    roles: ["owner", "manager"],
    deniedText: "This account doesn't have an owner or manager role.",
    wide: true,
    start: startOwner,
  });
}
