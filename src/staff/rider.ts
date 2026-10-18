import { clock, escapeHtml, naira, startStaffScreen, type StaffContext } from "./shell.js";

interface Delivery {
  id: string;
  orderNumber: string;
  fulfillmentStatus: string;
  customerFirstName: string;
  phone: string | null;
  address: string | null;
  landmark: string | null;
  instructions: string | null;
  area: string | null;
  scheduledFor: string | null;
  createdAt: string;
  collectMinor: number;
  currency: string;
  items: string[];
}

const reasons = ["No answer", "Wrong address", "Customer refused", "Couldn't reach the address", "Other"];

const statusLabel: Record<string, string> = {
  accepted: "In the kitchen",
  preparing: "In the kitchen",
  ready_for_delivery: "Ready to pick up",
  out_for_delivery: "Out for delivery",
  delivery_exception: "Problem reported",
};

function startRider(context: StaffContext): void {
  let deliveries: Delivery[] = [];
  let deliveredToday = 0;
  let offline = false;
  let busy = false;
  // Which card is showing the payment or problem step.
  let step: { id: string; kind: "paid" | "problem"; reason?: string } | null = null;

  const list = document.createElement("div");
  context.board.className = "rider-board";
  context.board.append(list);

  const render = (): void => {
    if (busy) return;
    const active = deliveries.filter((delivery) => delivery.fulfillmentStatus !== "delivery_exception");
    list.innerHTML = `
      <div class="rider-head">
        <div><div class="eyebrow dark">Rider</div><h1>My deliveries</h1></div>
        <div class="rider-stats"><strong>${active.length}</strong><span>to deliver</span><strong>${deliveredToday}</strong><span>done today</span></div>
      </div>
      ${offline ? `<p class="rider-offline" role="alert">You're offline or the connection dropped. Reconnecting…</p>` : ""}
      ${deliveries.length ? deliveries.map(card).join("") : `<div class="kitchen-empty"><div class="kitchen-empty-mark">✓</div><h2>No deliveries right now</h2><p>New deliveries appear here when the manager assigns them to you.</p></div>`}`;
  };

  const card = (delivery: Delivery): string => {
    const maps = delivery.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${delivery.address}${delivery.landmark ? `, ${delivery.landmark}` : ""}, Abuja`)}` : null;
    const showing = step?.id === delivery.id ? step : null;
    let actions = "";
    if (delivery.fulfillmentStatus === "ready_for_delivery") {
      actions = `<button class="btn rider-primary" type="button" data-out="${delivery.id}">Picked up · start delivery</button>`;
    } else if (delivery.fulfillmentStatus === "out_for_delivery") {
      if (showing?.kind === "paid") {
        actions = `<p class="rider-ask">How did ${escapeHtml(delivery.customerFirstName)} pay ${escapeHtml(naira(delivery.collectMinor, delivery.currency))}?</p>
          <div class="rider-row"><button class="btn rider-primary" type="button" data-delivered="${delivery.id}" data-collected="cash">Cash</button><button class="btn rider-primary" type="button" data-delivered="${delivery.id}" data-collected="pos">POS</button></div>
          <button class="rider-link" type="button" data-cancel-step>Back</button>`;
      } else if (showing?.kind === "problem") {
        actions = `<p class="rider-ask">What went wrong?</p>
          <div class="rider-chips">${reasons.map((reason) => `<button type="button" class="rider-chip" aria-pressed="${showing.reason === reason}" data-reason="${escapeHtml(reason)}">${escapeHtml(reason)}</button>`).join("")}</div>
          <label class="form-field">Note for the manager <span class="field-optional">Optional</span><input data-note maxlength="300" placeholder="e.g. Called twice, gate locked" /></label>
          <div class="rider-row"><button class="btn rider-danger" type="button" data-report="${delivery.id}" ${showing.reason ? "" : "disabled"}>Report problem</button><button class="rider-link" type="button" data-cancel-step>Back</button></div>`;
      } else {
        actions = `<button class="btn rider-primary" type="button" data-arrived="${delivery.id}">${delivery.collectMinor ? `Delivered · collect ${escapeHtml(naira(delivery.collectMinor, delivery.currency))}` : "Delivered"}</button>
          <button class="rider-link" type="button" data-problem="${delivery.id}">Report a problem</button>`;
      }
    } else if (delivery.fulfillmentStatus === "delivery_exception") {
      actions = `<p class="rider-hint">You reported a problem. The manager will retry or cancel this delivery.</p>`;
    } else {
      actions = `<p class="rider-hint">Still in the kitchen. You'll be able to pick it up when it's ready.</p>`;
    }
    return `<article class="rider-card status-${delivery.fulfillmentStatus}">
      <div class="rider-card-top"><h2>${escapeHtml(delivery.orderNumber)}</h2><span class="kitchen-status status-${delivery.fulfillmentStatus}">${escapeHtml(statusLabel[delivery.fulfillmentStatus] ?? delivery.fulfillmentStatus)}</span></div>
      <p class="rider-customer"><strong>${escapeHtml(delivery.customerFirstName)}</strong>${delivery.area ? ` · ${escapeHtml(delivery.area)}` : ""}${delivery.scheduledFor ? ` · for ${clock(delivery.scheduledFor)}` : ""}</p>
      <p class="rider-address">${escapeHtml(delivery.address ?? "")}</p>
      ${delivery.landmark ? `<p class="rider-landmark">Landmark: <strong>${escapeHtml(delivery.landmark)}</strong></p>` : ""}
      ${delivery.instructions ? `<p class="kitchen-note">Note: ${escapeHtml(delivery.instructions)}</p>` : ""}
      ${delivery.collectMinor ? `<p class="rider-collect">Collect ${escapeHtml(naira(delivery.collectMinor, delivery.currency))} · cash or POS</p>` : `<p class="rider-paid">Already paid</p>`}
      <p class="rider-items">${escapeHtml(delivery.items.join(" · "))}</p>
      <div class="rider-row">
        ${delivery.phone ? `<a class="rider-secondary" href="tel:${escapeHtml(delivery.phone.replace(/[^\d+]/g, ""))}">Call ${escapeHtml(delivery.customerFirstName)}</a>` : ""}
        ${maps ? `<a class="rider-secondary" href="${escapeHtml(maps)}" target="_blank" rel="noopener">Directions</a>` : ""}
      </div>
      <div class="rider-actions">${actions}</div>
    </article>`;
  };

  const load = async (): Promise<void> => {
    try {
      const response = await context.request("/api/rider/deliveries");
      if (!response.ok) throw new Error("Could not load deliveries");
      const result = await response.json() as { deliveries: Delivery[]; deliveredToday: number };
      deliveries = result.deliveries;
      deliveredToday = result.deliveredToday;
      offline = false;
      if (step && !deliveries.some((delivery) => delivery.id === step!.id && delivery.fulfillmentStatus === "out_for_delivery")) step = null;
    } catch {
      offline = true;
    }
    render();
  };

  const act = async (orderId: string, action: string, body: Record<string, unknown>, done: string): Promise<void> => {
    busy = true;
    try {
      const response = await context.request(`/api/rider/orders/${orderId}/${action}`, { method: "PATCH", body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not update this delivery.");
      context.setMessage(done);
      step = null;
    } catch (error) {
      context.setMessage(error instanceof Error ? error.message : "Could not update this delivery.", "error");
    } finally {
      busy = false;
    }
    await load();
  };

  list.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("button");
    if (!target || (target as HTMLButtonElement).disabled) return;
    const delivery = (id: string | undefined) => deliveries.find((entry) => entry.id === id);
    if (target.dataset.out) return void act(target.dataset.out, "out", {}, `${delivery(target.dataset.out)?.orderNumber} is out for delivery. Drive safely.`);
    if (target.dataset.arrived) {
      const entry = delivery(target.dataset.arrived);
      if (entry?.collectMinor) {
        step = { id: entry.id, kind: "paid" };
        return render();
      }
      return void act(target.dataset.arrived, "delivered", {}, `${entry?.orderNumber} delivered.`);
    }
    if (target.dataset.delivered) return void act(target.dataset.delivered, "delivered", { collected: target.dataset.collected }, `${delivery(target.dataset.delivered)?.orderNumber} delivered and paid by ${target.dataset.collected === "pos" ? "POS" : "cash"}.`);
    if (target.dataset.problem) {
      step = { id: target.dataset.problem, kind: "problem" };
      return render();
    }
    if (target.dataset.reason && step) {
      step = { ...step, reason: target.dataset.reason };
      return render();
    }
    if (target.dataset.report && step?.reason) {
      const note = list.querySelector<HTMLInputElement>("[data-note]")?.value ?? "";
      return void act(target.dataset.report, "exception", { reason: step.reason, note }, "Problem reported. The manager has been told.");
    }
    if (target.matches("[data-cancel-step]")) {
      step = null;
      render();
    }
  });
  window.addEventListener("online", () => void load());
  window.addEventListener("offline", () => { offline = true; render(); });

  context.addTopButton("Refresh", () => void load());
  void load();
  context.every(20_000, () => { if (!step) void load(); });
}

export function startRiderScreen(app: HTMLElement): void {
  startStaffScreen(app, {
    title: "Rider deliveries",
    eyebrow: "Rider",
    intro: "Sign in with your Ivy rider account to see the deliveries assigned to you.",
    roles: ["rider"],
    deniedText: "This account doesn't have the rider role. Ask HR to add it.",
    start: startRider,
  });
}
