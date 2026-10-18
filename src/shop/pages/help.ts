import { apiUrl } from "../../api.js";
import { currentProfile, currentSession, onAccountChange } from "../account.js";
import { esc, money } from "../format.js";
import { areas, findKitchen, kitchenHours, kitchenPhone, onConfigChange, payments } from "../zones.js";

export function renderHelp(view: HTMLElement): () => void {
  let sent = false;
  let error = "";
  let sending = false;
  const params = new URLSearchParams(window.location.search);
  const draft = { name: "", contact: "", topic: params.get("order") ? "order" : "", orderNumber: params.get("order") ?? "", message: "" };

  const faqs = (): Array<{ q: string; a: string }> => {
    const hours = kitchenHours(findKitchen(null)?.id);
    const delivering = areas().filter((area) => !area.outOfZone);
    const notYet = areas().filter((area) => area.outOfZone);
    return [
      { q: "Where do you deliver, and what does it cost?", a: delivering.length
        ? `${delivering.map((area) => `${esc(area.name)} (${esc(money(area.feeMinor))} delivery, ${esc(money(area.minimumMinor))} minimum, about ${esc(area.eta)} min)`).join("; ")}.${notYet.length ? ` We don't deliver to ${esc(notYet.map((area) => area.name).join(", "))} yet, but you can order for pickup.` : ""}`
        : "Choose your area when you start an order to see delivery times, fees and minimums." },
      { q: "When are you open?", a: `Every day, ${esc(hours.opensAt)} to ${esc(hours.closesAt)} (Abuja time). When we're closed you can still order for later.` },
      { q: "How can I pay?", a: `Pay on delivery with cash or by card on the rider's POS, or at the counter for pickup.${payments().transfer ? " You can also pay by bank transfer: we show the account details after you order, and you have 30 minutes to transfer." : ""} Card payments online are coming soon.` },
      { q: "Can I order without an account?", a: "Yes. Continue as a guest at checkout. You can follow your order with the link on your confirmation, or with your order number and phone number." },
      { q: "Can I change or cancel my order?", a: "Contact us as soon as possible using the form below or by phone. Once the kitchen has started, we may not be able to change it." },
      { q: "Do you cater for allergies?", a: "Every dish lists its allergens on the menu, and you can hide dishes that contain them. Our kitchen handles all 14 major allergens, so we can't rule out traces. Ask the team if you have a severe allergy." },
      { q: "When will I get a refund?", a: "If we can't take your order after you've paid, we start a refund straight away. Refunds usually reach your bank within 5 working days. You can see the status in your account." },
    ];
  };

  const render = (): void => {
    const phone = kitchenPhone();
    const profile = currentProfile();
    if (currentSession() && !draft.name) draft.name = profile?.displayName ?? "";
    if (currentSession() && !draft.contact) draft.contact = currentSession()?.user.email ?? "";
    view.innerHTML = `
      <section class="wrap help-page view">
        <p class="kicker">Help</p>
        <h1 class="page-title" tabindex="-1" data-page-heading>How can we help?</h1>
        <div class="help-grid">
          <div class="stack" style="gap:10px">
            <h2 style="font-size:24px;margin-top:8px">Questions people ask</h2>
            ${faqs().map((faq) => `<details class="panel faq"><summary>${esc(faq.q)}</summary><p>${faq.a}</p></details>`).join("")}
            <div class="panel"><h2 style="font-size:22px">Following an order?</h2><p class="muted" style="margin:8px 0 14px">Track it from the kitchen to your door.</p><a class="btn btn-outline btn-sm" href="/track">Track an order</a></div>
          </div>
          <div class="panel" id="contact">
            <h2 style="font-size:24px">Contact us</h2>
            ${phone ? `<p style="margin:10px 0 0">Call or WhatsApp the kitchen: <a href="tel:${esc(phone.replace(/\s/g, ""))}" style="font-weight:800">${esc(phone)}</a></p>` : ""}
            <p class="muted" style="margin:10px 0 16px">Send us a message and the team will get back to you, usually within the hour while we're open.</p>
            ${sent ? `<div class="notice ok" role="status"><strong>Thanks, we've got your message.</strong> We'll reply on ${esc(draft.contact)}.</div><button class="btn btn-outline btn-sm" type="button" data-again style="margin-top:12px">Send another message</button>` : `
            <form class="form-grid" data-help novalidate>
              <div class="field"><label for="hp-topic">What's it about?</label>
                <select id="hp-topic" name="topic" required>
                  <option value="">Choose one</option>
                  ${[["order", "An order"], ["payment", "A payment or refund"], ["account", "My account"], ["feedback", "Feedback"], ["other", "Something else"]].map(([value, label]) => `<option value="${value}" ${draft.topic === value ? "selected" : ""}>${label}</option>`).join("")}
                </select>
              </div>
              <div class="field"><label for="hp-order">Order number <span class="opt-tag">(optional)</span></label><input id="hp-order" name="orderNumber" placeholder="IVY-00000123" value="${esc(draft.orderNumber)}" autocapitalize="characters" /></div>
              <div class="field"><label for="hp-name">Your name</label><input id="hp-name" name="name" autocomplete="name" value="${esc(draft.name)}" maxlength="100" /></div>
              <div class="field"><label for="hp-contact">Phone or email</label><input id="hp-contact" name="contact" autocomplete="email" value="${esc(draft.contact)}" maxlength="254" /></div>
              <div class="field"><label for="hp-message">Message</label><textarea id="hp-message" name="message" maxlength="2000" rows="5">${esc(draft.message)}</textarea></div>
              ${error ? `<p class="notice error" role="alert" style="margin:0">${esc(error)}</p>` : ""}
              <button class="btn btn-gold" type="submit" ${sending ? "disabled" : ""}>${sending ? "Sending…" : "Send message"}</button>
            </form>`}
          </div>
        </div>
      </section>`;
  };

  const onInput = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    if (input.name in draft) (draft as Record<string, string>)[input.name] = input.value;
  };

  const onSubmit = async (event: Event): Promise<void> => {
    if (!(event.target as HTMLElement).matches("[data-help]")) return;
    event.preventDefault();
    error = "";
    if (!draft.topic) error = "Choose what your message is about.";
    else if (!draft.name.trim()) error = "Enter your name.";
    else if (!draft.contact.trim()) error = "Enter a phone number or email so we can reply.";
    else if (!draft.message.trim()) error = "Tell us what happened.";
    if (error) return render();
    sending = true;
    render();
    try {
      const response = await fetch(apiUrl("/api/support"), {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, orderNumber: draft.orderNumber.trim() }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "We couldn't send your message.");
      sent = true;
    } catch (failure) {
      error = failure instanceof TypeError ? "We couldn't reach the server. Check your connection and try again." : failure instanceof Error ? failure.message : "We couldn't send your message.";
    } finally {
      sending = false;
    }
    render();
  };

  const onClick = (event: Event): void => {
    if ((event.target as HTMLElement).closest("[data-again]")) {
      sent = false;
      draft.message = "";
      render();
    }
  };

  render();
  view.addEventListener("input", onInput);
  view.addEventListener("change", onInput);
  view.addEventListener("submit", onSubmit);
  view.addEventListener("click", onClick);
  const stops = [onConfigChange(() => { if (!sending) render(); }), onAccountChange(() => { if (!sending && !sent) render(); })];
  return () => {
    stops.forEach((stop) => stop());
    view.removeEventListener("input", onInput);
    view.removeEventListener("change", onInput);
    view.removeEventListener("submit", onSubmit);
    view.removeEventListener("click", onClick);
  };
}
