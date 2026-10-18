import { apiUrl } from "../../api.js";
import { currentProfile, currentSession, onAccountChange, refreshProfile, sessionRestored, signOut } from "../account.js";
import { addLine, type BasketLine } from "../basket.js";
import { esc, money } from "../format.js";
import { findItem, getMenu, lineAvailable, loadMenu } from "../menu-data.js";
import { navigate } from "../router.js";
import { showToast } from "../toast.js";
import { areas } from "../zones.js";

interface HistoryOrder {
  orderNumber: string;
  fulfillmentStatus: string;
  paymentStatus: string;
  paymentMethod: string;
  mode: string;
  totalMinor: number;
  currency: string;
  createdAt: string;
  scheduledFor: string | null;
  review: { rating: number; body: string } | null;
  refundedMinor: number;
  items: Array<{ name: string; summary: string; quantity: number; lineTotalMinor: number }>;
}

interface Address { id: string; label: string; recipientName: string; phone: string; address: string; landmark: string | null; instructions: string | null; isDefault: boolean }
interface Profile { displayName: string; email: string | null; phone: string | null; memberSince: string | null }

type Tab = "orders" | "addresses" | "details";

const statusText: Record<string, string> = {
  awaiting_acceptance: "Waiting for the kitchen", accepted: "Accepted", preparing: "Preparing", ready_for_delivery: "Ready",
  out_for_delivery: "Out for delivery", delivered: "Delivered", rejected: "Not accepted", cancelled: "Cancelled", delivery_exception: "Delivery problem",
};
const paymentText: Record<string, string> = {
  pending: "Payment due", paid: "Paid", failed: "Payment failed", refund_pending: "Refund in progress", partially_refunded: "Partly refunded", refunded: "Refunded",
};
const active = new Set(["awaiting_acceptance", "accepted", "preparing", "ready_for_delivery", "out_for_delivery", "delivery_exception"]);

async function api<T>(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(apiUrl(path), { ...init, headers, credentials: "include" });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  return { ok: response.ok, status: response.status, data };
}

export function renderAccountPage(view: HTMLElement, initialTab: string | null): () => void {
  let tab: Tab = initialTab === "addresses" || initialTab === "details" ? initialTab : "orders";
  let orders: HistoryOrder[] | null = null;
  let addresses: Address[] | null = null;
  let profile: Profile | null = null;
  let loadError = "";
  let editing: string | "new" | null = null;
  let confirmDelete: string | null = null;
  let rating: { orderNumber: string; stars: number } | null = null;
  let formError = "";
  let expired = false;

  const load = async (): Promise<void> => {
    loadError = "";
    try {
      const [ordersResponse, addressResponse, profileResponse] = await Promise.all([
        api<{ orders: HistoryOrder[] }>("/api/customer/orders"),
        api<{ addresses: Address[] }>("/api/customer/addresses"),
        api<Profile>("/api/customer/profile"),
      ]);
      if (ordersResponse.status === 401) {
        expired = true;
        return render();
      }
      if (!ordersResponse.ok) throw new Error();
      orders = ordersResponse.data.orders;
      addresses = addressResponse.ok ? addressResponse.data.addresses : [];
      profile = profileResponse.ok ? profileResponse.data : null;
    } catch {
      loadError = "We couldn't load your account. Check your connection and try again.";
    }
    render();
  };

  const ordersMarkup = (): string => {
    if (!orders) return `<div class="skeleton" style="height:180px"></div>`;
    if (!orders.length) return `<div class="state-box"><h2>No orders yet</h2><p>Your orders will appear here, ready to track or reorder.</p><a class="btn btn-gold" href="/menu">Order now</a></div>`;
    return `<div class="stack" style="gap:14px">${orders.map((order) => {
      const date = new Date(order.createdAt).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
      const delivered = order.fulfillmentStatus === "delivered";
      const ratingOpen = rating?.orderNumber === order.orderNumber;
      return `<article class="panel acct-order">
        <div class="acct-order-top">
          <div><strong>${esc(order.orderNumber)}</strong><span class="muted"> · ${esc(date)} · ${order.mode === "pickup" ? "Pickup" : "Delivery"}</span></div>
          <div class="acct-badges"><span class="acct-badge status-${esc(order.fulfillmentStatus)}">${esc(statusText[order.fulfillmentStatus] ?? order.fulfillmentStatus)}</span>
          <span class="acct-badge pay-${esc(order.paymentStatus)}">${esc(order.paymentStatus === "pending" && order.paymentMethod === "on_delivery" ? (order.mode === "pickup" ? "Pay at counter" : "Pay on delivery") : paymentText[order.paymentStatus] ?? order.paymentStatus)}</span></div>
        </div>
        <p class="acct-items">${esc(order.items.map((item) => `${item.quantity}× ${item.name}`).join(", "))}</p>
        ${order.paymentStatus === "refund_pending" ? `<p class="notice info" style="margin:0 0 10px">We're refunding ${esc(money(order.totalMinor, order.currency))}. Refunds usually reach your bank within 5 working days.</p>` : ""}
        ${order.refundedMinor ? `<p class="notice ok" style="margin:0 0 10px">Refunded ${esc(money(order.refundedMinor, order.currency))}.</p>` : ""}
        <div class="acct-order-foot">
          <strong>${esc(money(order.totalMinor, order.currency))}</strong>
          <div class="acct-actions">
            <a class="btn btn-sm ${active.has(order.fulfillmentStatus) ? "btn-gold" : "btn-outline"}" href="/track/${encodeURIComponent(order.orderNumber)}">${active.has(order.fulfillmentStatus) ? "Track" : "Details"}</a>
            <button class="btn btn-sm btn-outline" type="button" data-reorder="${esc(order.orderNumber)}">Reorder</button>
            ${delivered && !order.review && !ratingOpen ? `<button class="btn btn-sm btn-outline" type="button" data-rate="${esc(order.orderNumber)}">Rate</button>` : ""}
          </div>
        </div>
        ${order.review && !ratingOpen ? `<p class="acct-review"><span aria-label="${order.review.rating} out of 5 stars">${"★".repeat(order.review.rating)}${"☆".repeat(5 - order.review.rating)}</span> ${esc(order.review.body)} <button class="link-btn" type="button" data-rate="${esc(order.orderNumber)}" style="min-height:32px">Edit</button></p>` : ""}
        ${ratingOpen ? ratingForm(order) : ""}
      </article>`;
    }).join("")}</div>`;
  };

  const ratingForm = (order: HistoryOrder): string => {
    const stars = rating?.stars ?? order.review?.rating ?? 0;
    return `<form class="acct-rating" data-review="${esc(order.orderNumber)}" novalidate>
      <p style="margin:0 0 8px;font-weight:800">How was it?</p>
      <div class="stars" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5].map((value) => `<button type="button" role="radio" aria-checked="${value === stars}" aria-label="${value} star${value > 1 ? "s" : ""}" data-star="${value}" class="${value <= stars ? "on" : ""}">★</button>`).join("")}</div>
      <div class="field" style="margin-top:10px"><label for="rv-${esc(order.orderNumber)}">Tell the kitchen more <span class="opt-tag">(optional)</span></label><textarea id="rv-${esc(order.orderNumber)}" name="body" maxlength="1000">${esc(order.review?.body ?? "")}</textarea></div>
      ${formError ? `<p class="field-error" role="alert">${esc(formError)}</p>` : ""}
      <div style="display:flex;gap:10px;margin-top:10px"><button class="btn btn-gold btn-sm" type="submit">Send rating</button><button class="btn btn-sm" type="button" data-cancel>Cancel</button></div>
    </form>`;
  };

  const addressForm = (address: Address | null): string => {
    const parts = address?.address.split(",").map((part) => part.trim()) ?? [];
    const areaName = parts.find((part) => areas().some((area) => area.name === part)) ?? "";
    const street = address ? parts.filter((part) => part !== areaName && part !== "Abuja").join(", ") : "";
    return `<form class="panel form-grid" data-address-form="${address?.id ?? "new"}" novalidate>
      <h3 style="font-size:20px">${address ? "Edit address" : "New address"}</h3>
      <div class="form-2">
        <div class="field"><label for="ad-label">Label</label><input id="ad-label" name="label" value="${esc(address?.label ?? "Home")}" maxlength="60" /></div>
        <div class="field"><label for="ad-area">Area</label><select id="ad-area" name="area">${areas().filter((area) => !area.outOfZone).map((area) => `<option ${area.name === areaName ? "selected" : ""}>${esc(area.name)}</option>`).join("")}</select></div>
      </div>
      <div class="form-2">
        <div class="field"><label for="ad-name">Recipient</label><input id="ad-name" name="recipientName" autocomplete="name" value="${esc(address?.recipientName ?? currentProfile()?.displayName ?? "")}" /></div>
        <div class="field"><label for="ad-phone">Phone</label><input id="ad-phone" name="phone" type="tel" autocomplete="tel" placeholder="0803 123 4567" value="${esc(address?.phone ?? profile?.phone ?? "")}" /></div>
      </div>
      <div class="field"><label for="ad-street">Street address</label><input id="ad-street" name="street" autocomplete="address-line1" placeholder="e.g. 14 Kumasi Crescent" value="${esc(street)}" /></div>
      <div class="field"><label for="ad-landmark">Nearest landmark</label><input id="ad-landmark" name="landmark" placeholder="e.g. Opposite Banex Plaza" value="${esc(address?.landmark ?? "")}" /></div>
      <div class="field"><label for="ad-notes">Notes for the rider <span class="opt-tag">(optional)</span></label><input id="ad-notes" name="instructions" value="${esc(address?.instructions ?? "")}" maxlength="500" /></div>
      ${address ? "" : `<label class="check-line"><input type="checkbox" name="isDefault" ${addresses?.length ? "" : "checked"} /> Make this my default address</label>`}
      ${formError ? `<p class="field-error" role="alert">${esc(formError)}</p>` : ""}
      <div style="display:flex;gap:10px"><button class="btn btn-gold btn-sm" type="submit">Save address</button><button class="btn btn-sm" type="button" data-cancel>Cancel</button></div>
    </form>`;
  };

  const addressesMarkup = (): string => {
    if (!addresses) return `<div class="skeleton" style="height:140px"></div>`;
    return `<div class="stack" style="gap:12px">
      ${addresses.map((address) => editing === address.id ? addressForm(address) : `<article class="panel acct-address">
        <div class="acct-order-top"><strong>${esc(address.label)}</strong>${address.isDefault ? `<span class="acct-badge status-delivered">Default</span>` : ""}</div>
        <p style="margin:6px 0 2px">${esc(address.recipientName)} · ${esc(address.phone)}</p>
        <p class="muted" style="margin:0">${esc(address.address)}${address.landmark ? ` · ${esc(address.landmark)}` : ""}</p>
        ${confirmDelete === address.id
          ? `<div class="notice warn" style="margin-top:10px;display:flex;flex-wrap:wrap;align-items:center;gap:10px">Delete this address? <button class="btn btn-sm btn-outline" type="button" data-delete-yes="${address.id}">Delete</button><button class="link-btn" type="button" data-cancel>Keep it</button></div>`
          : `<div class="acct-actions" style="margin-top:10px"><button class="link-btn" type="button" data-edit-address="${address.id}">Edit</button>${address.isDefault ? "" : `<button class="link-btn" type="button" data-default="${address.id}">Set as default</button>`}<button class="link-btn danger" type="button" data-delete="${address.id}">Delete</button></div>`}
      </article>`).join("")}
      ${editing === "new" ? addressForm(null) : `<button class="btn btn-outline" type="button" data-new-address>Add an address</button>`}
    </div>`;
  };

  const detailsMarkup = (): string => `
    <form class="panel form-grid" data-profile novalidate style="max-width:520px">
      <div class="field"><label for="pf-name">Full name</label><input id="pf-name" name="displayName" autocomplete="name" value="${esc(profile?.displayName ?? currentProfile()?.displayName ?? "")}" maxlength="100" /></div>
      <div class="field"><label for="pf-phone">Phone <span class="opt-tag">(optional)</span></label><input id="pf-phone" name="phone" type="tel" autocomplete="tel" placeholder="0803 123 4567" value="${esc(profile?.phone ?? "")}" /></div>
      <div class="field"><label for="pf-email">Email</label><input id="pf-email" value="${esc(profile?.email ?? currentSession()?.user.email ?? "")}" readonly /></div>
      ${formError ? `<p class="field-error" role="alert">${esc(formError)}</p>` : ""}
      <button class="btn btn-gold" type="submit">Save details</button>
      <p class="muted" style="margin:0;font-size:14px">Want a new password? <a href="/forgot-password" style="font-weight:800">Send me a reset link</a>.</p>
      <p class="muted" style="margin:0;font-size:13px">We only email you about your orders and account.</p>
    </form>`;

  const render = (): void => {
    if (!sessionRestored()) {
      view.innerHTML = `<section class="wrap account-page view"><div class="skeleton" style="height:240px;margin-top:28px"></div></section>`;
      return;
    }
    if (!currentSession() || expired) {
      view.innerHTML = `<section class="wrap account-page view"><div class="state-box"><h1 tabindex="-1" data-page-heading style="font-size:30px">${expired ? "Your session has expired" : "Sign in to see your account"}</h1><p>Your orders, saved addresses and details are here once you sign in.</p><div class="state-actions"><a class="btn btn-gold" href="/signin?next=/account">Sign in</a><a class="btn btn-outline" href="/signup?next=/account">Create an account</a></div></div></section>`;
      return;
    }
    const name = profile?.displayName ?? currentProfile()?.displayName ?? "";
    view.innerHTML = `
      <section class="wrap account-page ${view.dataset.rendered ? "" : "view"}">
        <div class="acct-head">
          <div><p class="kicker">Your account</p><h1 class="page-title" tabindex="-1" data-page-heading>Hi${name ? `, ${esc(name.split(/\s+/)[0])}` : ""}</h1>
          ${profile?.memberSince ? `<p class="muted" style="margin:6px 0 0">Ordering with Ivy since ${esc(new Date(profile.memberSince).toLocaleDateString("en-NG", { month: "long", year: "numeric" }))}</p>` : ""}</div>
          <button class="btn btn-outline btn-sm" type="button" data-sign-out>Sign out</button>
        </div>
        <div class="cat-tabs" role="tablist" aria-label="Account sections" style="position:static;margin-top:18px">
          ${(["orders", "addresses", "details"] as const).map((value) => `<button class="chip" type="button" role="tab" aria-selected="${tab === value}" data-tab="${value}">${value === "orders" ? "Orders" : value === "addresses" ? "Addresses" : "Details"}</button>`).join("")}
        </div>
        ${loadError ? `<div class="notice error" role="alert">${esc(loadError)} <button class="link-btn" type="button" data-retry>Try again</button></div>` : ""}
        <div data-panel>${tab === "orders" ? ordersMarkup() : tab === "addresses" ? addressesMarkup() : detailsMarkup()}</div>
      </section>`;
    view.dataset.rendered = "1";
  };

  const reorder = async (orderNumber: string): Promise<void> => {
    if (getMenu().status !== "live") await loadMenu();
    const result = await api<{ lines: Array<{ name: string; exact: boolean; line: BasketLine }> }>(`/api/customer/orders/${encodeURIComponent(orderNumber)}/reorder`);
    if (!result.ok) return showToast({ text: result.data.error ?? "We couldn't load that order." });
    let added = 0;
    const missing: string[] = [];
    let changed = 0;
    for (const entry of result.data.lines) {
      const item = findItem(entry.line.menuItemId);
      if (!item || !lineAvailable(item, entry.line)) {
        missing.push(entry.name);
        continue;
      }
      if (addLine(entry.line).ok) {
        added += 1;
        if (!entry.exact) changed += 1;
      }
    }
    if (!added) return showToast({ text: `Nothing from ${orderNumber} is available right now.` });
    navigate("/basket");
    showToast({
      text: missing.length ? `${missing.join(", ")} ${missing.length === 1 ? "isn't" : "aren't"} available, so we added the rest.` : changed ? "Added. Some items came back with their standard options, so check them." : "Added to your basket. Prices are today's.",
      duration: 7000,
    });
  };

  const onClick = async (event: Event): Promise<void> => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("button");
    if (!target) return;
    const data = target.dataset;
    if (data.tab) {
      tab = data.tab as Tab;
      editing = null;
      formError = "";
      window.history.replaceState({}, "", tab === "orders" ? "/account" : `/account?tab=${tab}`);
      return render();
    }
    if (target.matches("[data-sign-out]")) {
      await signOut();
      navigate("/");
      return;
    }
    if (target.matches("[data-retry]")) return void load();
    if (data.reorder) return void reorder(data.reorder);
    if (data.rate) {
      const order = orders?.find((entry) => entry.orderNumber === data.rate);
      rating = { orderNumber: data.rate, stars: order?.review?.rating ?? 0 };
      formError = "";
      return render();
    }
    if (data.star && rating) {
      rating = { ...rating, stars: Number(data.star) };
      const body = view.querySelector<HTMLTextAreaElement>(`[data-review] textarea`)?.value;
      render();
      const textarea = view.querySelector<HTMLTextAreaElement>(`[data-review] textarea`);
      if (textarea && body !== undefined) textarea.value = body;
      view.querySelector<HTMLElement>(`[data-star="${data.star}"]`)?.focus();
      return;
    }
    if (target.matches("[data-cancel]")) {
      rating = null;
      editing = null;
      confirmDelete = null;
      formError = "";
      return render();
    }
    if (target.matches("[data-new-address]")) {
      editing = "new";
      formError = "";
      render();
      view.querySelector<HTMLElement>("#ad-label")?.focus();
      return;
    }
    if (data.editAddress) {
      editing = data.editAddress;
      formError = "";
      return render();
    }
    if (data.delete) {
      confirmDelete = data.delete;
      return render();
    }
    if (data.deleteYes) {
      const result = await api(`/api/customer/addresses/${data.deleteYes}`, { method: "DELETE" });
      confirmDelete = null;
      if (result.ok || result.status === 204) showToast({ text: "Address deleted" });
      return void load();
    }
    if (data.default) {
      await api(`/api/customer/addresses/${data.default}/default`, { method: "POST" });
      showToast({ text: "Default address updated" });
      return void load();
    }
  };

  const onSubmit = async (event: Event): Promise<void> => {
    const form = event.target as HTMLFormElement;
    event.preventDefault();
    const values = new FormData(form);
    formError = "";
    if (form.dataset.review) {
      if (!rating?.stars) {
        formError = "Choose from 1 to 5 stars.";
        return render();
      }
      const result = await api(`/api/customer/orders/${encodeURIComponent(form.dataset.review)}/review`, { method: "POST", body: JSON.stringify({ rating: rating.stars, body: values.get("body") }) });
      if (!result.ok) {
        formError = result.data.error ?? "We couldn't save your rating.";
        return render();
      }
      rating = null;
      showToast({ text: "Thanks for rating your order." });
      return void load();
    }
    if (form.dataset.addressForm) {
      const area = String(values.get("area") ?? "");
      const street = String(values.get("street") ?? "").trim();
      const payload = {
        label: values.get("label"), recipientName: values.get("recipientName"), phone: values.get("phone"),
        address: street ? [street, area, "Abuja"].filter(Boolean).join(", ") : "", landmark: values.get("landmark"), instructions: values.get("instructions"),
        isDefault: values.get("isDefault") === "on",
      };
      const id = form.dataset.addressForm;
      const result = await api(id === "new" ? "/api/customer/addresses" : `/api/customer/addresses/${id}`, { method: id === "new" ? "POST" : "PATCH", body: JSON.stringify(payload) });
      if (!result.ok) {
        formError = result.data.error ?? "We couldn't save this address.";
        return render();
      }
      editing = null;
      showToast({ text: "Address saved" });
      return void load();
    }
    if (form.matches("[data-profile]")) {
      const result = await api<Profile>("/api/customer/profile", { method: "PATCH", body: JSON.stringify({ displayName: values.get("displayName"), phone: values.get("phone") }) });
      if (!result.ok) {
        formError = result.data.error ?? "We couldn't save your details.";
        return render();
      }
      refreshProfile();
      showToast({ text: "Details saved" });
      return void load();
    }
  };

  delete view.dataset.rendered;
  render();
  if (sessionRestored() && currentSession()) void load();
  view.addEventListener("click", onClick);
  view.addEventListener("submit", onSubmit);
  const stop = onAccountChange(() => {
    if (currentSession() && !orders) void load();
    else render();
  });
  return () => {
    stop();
    view.removeEventListener("click", onClick);
    view.removeEventListener("submit", onSubmit);
    delete view.dataset.rendered;
  };
}
