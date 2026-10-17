import { currentSession, fetchDashboard, openAccount } from "../account.js";
import { categoryArt, pizzaArt } from "../art.js";
import { liveDeals } from "../deals.js";
import { esc, money } from "../format.js";
import { categories, getMenu, isOrderable, lowestPriceMinor, menuItems, onMenuChange, sizeOptions, sizeParts, type MenuItem } from "../menu-data.js";
import { getContext, isLocated } from "../order-context.js";
import { navigate } from "../router.js";
import { openAreaSheet } from "../sheets.js";
import { showToast } from "../toast.js";
import { onConfigChange, pickupReadyText } from "../zones.js";
import { latestGuestOrderNumber } from "./order-store.js";

function featuredPizza(): MenuItem | undefined {
  const items = menuItems().filter(isOrderable);
  return items.find((item) => /suya/i.test(item.name)) ?? items.find((item) => sizeOptions(item).length) ?? items[0];
}

function featureMarkup(): string {
  const menu = getMenu();
  if (menu.status === "error") return "";
  const item = featuredPizza();
  if (menu.status === "live" && !item) return "";
  const sizes = item ? sizeOptions(item).filter((option) => option.available) : [];
  const base = sizes[0] ? sizeParts(sizes[0].name) : null;
  return `
    <section class="wrap land-section" aria-labelledby="feat-title">
      <div class="feature-frame">
        <div class="feature">
          ${pizzaArt(item ?? { name: "Ivy Suya" }, { size: "family" })}
          <div class="feature-card">
            <span class="flag">Abuja favourite</span>
            <p class="label">Signature pizza</p>
            <h2 id="feat-title">${item ? `${esc(item.name)} <span>from ${esc(money(item.priceMinor!, item.currency))}</span>` : "Loading today's favourite…"}</h2>
            <p>${item ? esc(item.description) : "&nbsp;"}</p>
            ${item ? `<a class="btn btn-green btn-block btn-upper" href="/menu/${esc(item.slug)}" style="min-height:52px">Build yours</a>` : ""}
          </div>
        </div>
        ${base ? `<p class="fine"><strong>Prices vary by size.</strong> ${esc(base.label)} ${esc(base.detail)} shown. Larger sizes and extras cost more.</p>` : ""}
      </div>
    </section>`;
}

function dealsMarkup(): string {
  const deals = liveDeals();
  if (!deals.length) return "";
  return `
    <section class="wrap land-section" aria-labelledby="deals-title">
      <h2 class="section-title" id="deals-title" style="margin-bottom:16px">Explore more deals</h2>
      <div style="display:grid;grid-auto-flow:column;grid-auto-columns:min(86%,370px);gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:8px">
        ${deals.map((deal) => `
          <article style="scroll-snap-align:start;padding:8px;border-radius:12px;background:var(--sand)">
            <div class="feature-card" style="margin:0;width:100%">
              <p class="label">${esc(deal.kicker)}</p>
              <h2 style="font-size:23px">${esc(deal.title)} <span>${esc(deal.price)}</span></h2>
              <p>${esc(deal.body)}</p>
              <a class="btn btn-green btn-block btn-upper" href="${esc(deal.href)}">${esc(deal.cta)}</a>
            </div>
            <p class="fine" style="text-align:left"><strong>${esc(deal.fineLead)}</strong> ${esc(deal.fine)}</p>
          </article>`).join("")}
      </div>
    </section>`;
}

function categoriesMarkup(): string {
  const menu = getMenu();
  if (menu.status === "error") return "";
  const tiles = menu.status === "loading"
    ? Array.from({ length: 2 }, () => `<div class="cat-tile skeleton" aria-hidden="true"><div class="art"></div><div class="cat-tile-foot"><b>&nbsp;</b></div></div>`).join("")
    : categories().map((category) => {
        const lowest = lowestPriceMinor(category);
        const sample = menuItems().find((item) => item.category === category && /suya/i.test(item.name)) ?? menuItems().find((item) => item.category === category);
        return `<a class="cat-tile" href="/menu?category=${encodeURIComponent(category)}">
          ${categoryArt(category, sample)}
          <span class="cat-tile-foot"><b>${esc(category)}</b><span>${lowest === null ? "Coming soon" : `From ${esc(money(lowest))}`}</span></span>
        </a>`;
      }).join("");
  return `
    <section class="wrap land-section" aria-labelledby="crave-title">
      <h2 class="section-title" id="crave-title">What are you craving?</h2>
      <div class="cat-tiles" ${menu.status === "loading" ? `aria-busy="true"` : ""}>${tiles}</div>
    </section>`;
}

async function trackLatestOrder(button: HTMLButtonElement): Promise<void> {
  if (!currentSession()) {
    // Guests track the last order placed on this device, or look one up by number and phone.
    const guestOrder = latestGuestOrderNumber();
    navigate(guestOrder ? `/track/${encodeURIComponent(guestOrder)}` : "/track");
    return;
  }
  button.disabled = true;
  try {
    const dashboard = await fetchDashboard();
    const active = dashboard.orders.find((order) => ["awaiting_acceptance", "accepted", "preparing", "ready_for_delivery", "out_for_delivery"].includes(order.fulfillmentStatus));
    const order = active ?? dashboard.orders[0];
    if (order) navigate(`/track/${encodeURIComponent(order.orderNumber)}`);
    else showToast({ text: "You haven't placed an order yet.", actions: [{ label: "See the menu", href: "/menu" }] });
  } catch (error) {
    showToast({ text: error instanceof Error ? error.message : "We couldn't load your orders." });
  } finally {
    button.disabled = false;
  }
}

export function renderLanding(view: HTMLElement): () => void {
  const render = (): void => {
    view.innerHTML = `
      <div class="view" style="padding-bottom:24px">
        <section class="hero" aria-label="Welcome">
          <picture>
            <source type="image/webp" srcset="/ivy-food-hero-720.webp 720w, /ivy-food-hero-1200.webp 1200w, /ivy-food-hero.webp 1536w" sizes="100vw" />
            <img src="/ivy-food-hero-1200.webp" alt="An Ivy Suya pizza on a wooden board with jollof rice, plantain and suya" fetchpriority="high" width="1536" height="1024" />
          </picture>
          <div class="wrap hero-copy">
            <p class="hero-eyebrow">Pizza • Burgers • Fast delivery</p>
            <h1 tabindex="-1" data-page-heading>Abuja's new pizza <em>ritual.</em></h1>
            <p class="hero-lead">Premium fast food with unmistakable Ivy character: signature pizzas, flame-grilled burgers and a faster way to get your favourites.</p>
          </div>
        </section>
        <div class="wrap start-card-wrap">
          <div class="start-card">
            <h2>Start your order</h2>
            <div class="start-choices">
              <button class="big-choice gold" type="button" data-start="delivery"><b>Delivery</b><small>To your door in Abuja</small></button>
              <span class="or" aria-hidden="true">OR</span>
              <button class="big-choice green" type="button" data-start="pickup"><b>Pickup</b><small>Ready in about ${esc(pickupReadyText())}</small></button>
            </div>
          </div>
        </div>
        ${featureMarkup()}
        ${dealsMarkup()}
        ${categoriesMarkup()}
        <section class="wrap land-section" aria-label="Track an order">
          <div class="track-band">
            <div><h2>Already ordered?</h2><p>Follow your order from the oven to your door.</p></div>
            <button class="btn btn-gold" type="button" data-track style="min-height:52px;padding:0 28px">Track my order</button>
          </div>
        </section>
      </div>`;
  };
  render();

  const onClick = (event: Event): void => {
    const target = event.target as HTMLElement;
    const start = target.closest<HTMLElement>("[data-start]")?.dataset.start;
    if (start === "delivery") {
      if (getContext().mode === "delivery" && isLocated()) navigate("/menu");
      else openAreaSheet({ mode: "delivery", then: () => navigate("/menu") });
    }
    if (start === "pickup") {
      if (getContext().mode === "pickup" && isLocated()) navigate("/menu");
      else openAreaSheet({ mode: "pickup", then: () => navigate("/menu") });
    }
    const track = target.closest<HTMLButtonElement>("[data-track]");
    if (track) void trackLatestOrder(track);
  };
  view.addEventListener("click", onClick);
  const stopMenu = onMenuChange(render);
  const stopConfig = onConfigChange(render);
  return () => {
    stopMenu();
    stopConfig();
    view.removeEventListener("click", onClick);
  };
}
