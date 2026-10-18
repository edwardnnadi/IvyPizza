import { beep, clock, escapeHtml, startStaffScreen, type StaffContext } from "./shell.js";

interface Ticket {
  id: string;
  order_number: string;
  fulfillment_status: "accepted" | "preparing" | "ready_for_delivery" | "cancelled";
  created_at: string;
  fulfilment_mode?: "delivery" | "pickup";
  scheduled_for?: string | null;
  accepted_at?: string | null;
  preparing_at?: string | null;
  cancel_reason?: string | null;
  items: Array<{ item: { name?: string; summary?: string; instructions?: string; options?: Array<{ name?: string }> } | null; quantity: number }>;
}

interface MenuState {
  items: Array<{ id: string; name: string; category: string; available: boolean }>;
  ingredients: Array<{ name: string; available: boolean }>;
}

const soundKey = "ivy-kds-sound";

function minutesSince(value: string | null | undefined): number {
  return value ? Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000)) : 0;
}

function chips(ticketItem: Ticket["items"][number]): string {
  const item = ticketItem.item ?? {};
  const mods = item.summary ? item.summary.split(" · ") : (item.options ?? []).map((option) => option.name ?? "").filter(Boolean);
  return mods.map((mod) => {
    const half = /\((left|right) half\)/i.exec(mod);
    const text = half ? mod.replace(/\s*\((left|right) half\)/i, ` · ${half[1]!.toUpperCase()} HALF`) : mod;
    return `<span class="${/^No /.test(mod) ? "is-removal" : half ? "is-half" : ""}">${escapeHtml(text)}</span>`;
  }).join("");
}

function startKitchen(context: StaffContext): void {
  let tickets: Ticket[] = [];
  let known = new Set<string>();
  let firstLoad = true;
  let offline = false;
  let busy = false;
  let showMenu = false;
  let menu: MenuState | null = null;
  let sound = (() => { try { return localStorage.getItem(soundKey) === "on"; } catch { return false; } })();

  const root = document.createElement("div");
  context.board.className = "kds";
  context.board.append(root);
  const soundButton = context.addTopButton(sound ? "Sound on" : "Sound off", () => {
    sound = !sound;
    try { localStorage.setItem(soundKey, sound ? "on" : "off"); } catch { /* per visit only */ }
    soundButton.textContent = sound ? "Sound on" : "Sound off";
    if (sound) beep();
  });
  const menuButton = context.addTopButton("Sold out (86)", () => {
    showMenu = !showMenu;
    menuButton.textContent = showMenu ? "Back to tickets" : "Sold out (86)";
    if (showMenu) void loadMenu();
    render();
  });

  const ticketCard = (ticket: Ticket): string => {
    const age = minutesSince(ticket.accepted_at ?? ticket.created_at);
    const sla = ticket.fulfillment_status === "ready_for_delivery" ? "ok" : age >= 20 ? "late" : age >= 10 ? "warn" : "ok";
    const action = ticket.fulfillment_status === "accepted" ? `<button class="btn kds-action" type="button" data-advance="${ticket.id}" data-to="preparing">Start preparing</button>`
      : ticket.fulfillment_status === "preparing" ? `<button class="btn kds-action" type="button" data-advance="${ticket.id}" data-to="ready_for_delivery">Mark ready</button>`
      : `<p class="kds-waiting">${ticket.fulfilment_mode === "pickup" ? "Waiting for the customer" : "Waiting for the rider"}</p>`;
    return `<article class="kds-ticket sla-${sla}">
      <div class="kds-ticket-top"><h3>${escapeHtml(ticket.order_number.replace("IVY-", "#"))}</h3><span class="kds-timer" title="Minutes since accepted">${age} min</span></div>
      <p class="kds-meta"><strong>${ticket.fulfilment_mode === "pickup" ? "PICKUP" : "DELIVERY"}</strong> · ${ticket.scheduled_for ? `<span class="kds-scheduled">FOR ${clock(ticket.scheduled_for)}</span>` : "ASAP"}</p>
      <ul class="kds-items">${ticket.items.map((entry) => `<li><span class="kds-qty">${entry.quantity}×</span><div><strong>${escapeHtml(entry.item?.name ?? "Item")}</strong><div class="kitchen-mods">${chips(entry)}</div>${entry.item?.instructions ? `<p class="kitchen-note">Note: ${escapeHtml(entry.item.instructions)}</p>` : ""}</div></li>`).join("")}</ul>
      ${action}
    </article>`;
  };

  const lane = (title: string, status: Ticket["fulfillment_status"], empty: string): string => {
    const lanes = tickets.filter((ticket) => ticket.fulfillment_status === status);
    return `<section class="kds-lane" aria-label="${escapeHtml(title)}"><h2>${escapeHtml(title)} <span>${lanes.length}</span></h2>${lanes.length ? lanes.map(ticketCard).join("") : `<p class="kds-empty">${escapeHtml(empty)}</p>`}</section>`;
  };

  const render = (): void => {
    if (busy) return;
    if (showMenu) return renderMenu();
    const cancelled = tickets.filter((ticket) => ticket.fulfillment_status === "cancelled");
    root.innerHTML = `
      ${offline ? `<p class="rider-offline" role="alert">Connection lost. Reconnecting… Tickets below may be out of date.</p>` : ""}
      ${cancelled.map((ticket) => `<div class="kds-cancelled" role="alert"><strong>STOP · ${escapeHtml(ticket.order_number)} was cancelled.</strong> ${escapeHtml(ticket.cancel_reason ?? "")}</div>`).join("")}
      <div class="kds-lanes">
        ${lane("New", "accepted", "No new tickets.")}
        ${lane("Preparing", "preparing", "Nothing on the line.")}
        ${lane("Ready", "ready_for_delivery", "Nothing waiting.")}
      </div>`;
  };

  const renderMenu = (): void => {
    if (!menu) {
      root.innerHTML = `<p class="kds-empty">Loading the menu…</p>`;
      return;
    }
    const categories = [...new Set(menu.items.map((item) => item.category))];
    root.innerHTML = `
      <div class="kds-menu">
        <p class="manager-hint">Switch off anything you've run out of. Customers see it as sold out straight away.</p>
        ${categories.map((category) => `<section><h2>${escapeHtml(category)}</h2><div class="kds-toggles">${menu!.items.filter((item) => item.category === category).map((item) => `
          <button type="button" class="kds-toggle" role="switch" aria-checked="${item.available}" data-item="${item.id}" data-available="${!item.available}"><span>${escapeHtml(item.name)}</span><b>${item.available ? "Available" : "Sold out"}</b></button>`).join("")}</div></section>`).join("")}
        <section><h2>Toppings, crusts and sauces</h2><div class="kds-toggles">${menu.ingredients.map((ingredient) => `
          <button type="button" class="kds-toggle" role="switch" aria-checked="${ingredient.available}" data-ingredient="${escapeHtml(ingredient.name)}" data-available="${!ingredient.available}"><span>${escapeHtml(ingredient.name)}</span><b>${ingredient.available ? "Available" : "Sold out"}</b></button>`).join("")}</div></section>
      </div>`;
  };

  const load = async (): Promise<void> => {
    try {
      const response = await context.request("/api/kitchen/orders");
      if (!response.ok) throw new Error();
      const result = await response.json() as { orders: Ticket[] };
      const incoming = result.orders.filter((ticket) => ticket.fulfillment_status === "accepted").map((ticket) => ticket.id);
      if (!firstLoad && sound && incoming.some((id) => !known.has(id))) beep();
      known = new Set(incoming);
      firstLoad = false;
      tickets = result.orders;
      offline = false;
    } catch {
      offline = true;
    }
    render();
  };

  const loadMenu = async (): Promise<void> => {
    const response = await context.request("/api/kitchen/menu");
    if (response.ok) menu = await response.json() as MenuState;
    render();
  };

  root.addEventListener("click", async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button || button.disabled) return;
    if (button.dataset.advance) {
      busy = true;
      button.disabled = true;
      button.textContent = "Saving…";
      const response = await context.request(`/api/kitchen/orders/${button.dataset.advance}/status`, { method: "PATCH", body: JSON.stringify({ status: button.dataset.to }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      busy = false;
      context.setMessage(response.ok ? "" : result.error ?? "Could not update this ticket.", response.ok ? "info" : "error");
      await load();
      return;
    }
    const available = button.dataset.available === "true";
    if (button.dataset.item) {
      await context.request(`/api/kitchen/menu/items/${button.dataset.item}`, { method: "PATCH", body: JSON.stringify({ available }) });
      await loadMenu();
    } else if (button.dataset.ingredient) {
      await context.request("/api/kitchen/menu/ingredients", { method: "PATCH", body: JSON.stringify({ name: button.dataset.ingredient, available }) });
      await loadMenu();
    }
  });
  window.addEventListener("online", () => void load());

  void load();
  context.every(10_000, () => void load());
  // Timers move on between polls.
  context.every(30_000, render);
}

export function startKitchenScreen(app: HTMLElement): void {
  startStaffScreen(app, {
    title: "Kitchen display",
    eyebrow: "Kitchen",
    intro: "Sign in with your Ivy staff account to see accepted orders.",
    roles: ["kitchen", "manager", "owner"],
    deniedText: "This account doesn't have a kitchen, manager or owner role. Ask HR to grant the correct staff role.",
    wide: true,
    start: startKitchen,
  });
}
