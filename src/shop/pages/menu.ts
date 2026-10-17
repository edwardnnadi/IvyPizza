import { itemArt } from "../art.js";
import { esc, money } from "../format.js";
import { quickAdd } from "../feedback.js";
import { allergenList, categories, getMenu, isOrderable, itemKind, loadMenu, menuItems, onMenuChange, type MenuItem } from "../menu-data.js";
import { setVoucherCode } from "../basket.js";
import { showToast } from "../toast.js";
import { areaLabel, getContext, onContextChange } from "../order-context.js";
import { navigate } from "../router.js";
import { openAllergenSheet, openAreaSheet, openItemSheet } from "../sheets.js";

const allergenStorageKey = "ivy-pizza-hidden-allergens-v1";

function readHiddenAllergens(): Set<string> {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(allergenStorageKey) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);
  } catch {
    return new Set();
  }
}

function card(item: MenuItem, index: number): string {
  const orderable = isOrderable(item);
  const kind = itemKind(item);
  const price = item.priceMinor === null ? "Price coming soon" : `${kind === "pizza" ? "From " : ""}${money(item.priceMinor, item.currency)}`;
  const cta = !orderable
    ? `<button class="btn btn-green btn-sm" type="button" disabled>Unavailable</button>`
    : kind === "pizza"
      ? `<a class="btn btn-green btn-sm" href="/menu/${esc(item.slug)}" aria-label="Customise ${esc(item.name)}">Customise</a>`
      : kind === "configurable"
        ? `<button class="btn btn-green btn-sm" type="button" data-configure="${esc(item.id)}" aria-label="Customise ${esc(item.name)}">Customise</button>`
        : `<button class="btn btn-green btn-sm" type="button" data-add="${esc(item.id)}" aria-label="Add ${esc(item.name)}">Add</button>`;
  return `
    <article class="item-card ${orderable ? "" : "is-unavailable"}" data-item-id="${esc(item.id)}" style="animation-delay:${Math.min(index, 8) * 40}ms">
      ${itemArt(item)}
      <div class="item-body">
        <h3>${esc(item.name)}</h3>
        ${orderable ? "" : `<span class="badge">${item.priceMinor === null ? "Coming soon" : "Sold out today"}</span>`}
        <p>${esc(item.description)}</p>
        ${item.allergens.length ? `<p style="font-size:12px;font-weight:700;color:var(--gold-ink)">Contains ${esc(item.allergens.join(", ").toLowerCase())}</p>` : ""}
        <div class="item-foot"><span class="price">${esc(price)}</span>${cta}</div>
      </div>
    </article>`;
}

export function renderMenu(view: HTMLElement, initialCategory: string | null): () => void {
  let category = initialCategory && initialCategory !== "All" ? initialCategory : "All";
  let query = "";
  let hiddenAllergens = readHiddenAllergens();
  const visible = (item: MenuItem): boolean => !item.allergens.some((allergen) => hiddenAllergens.has(allergen));

  const listMarkup = (): string => {
    const menu = getMenu();
    if (menu.status === "loading") {
      return `<div class="menu-grid" aria-busy="true" aria-label="Loading menu">${Array.from({ length: 6 }, () => `<div class="skeleton" aria-hidden="true"><div class="sk-art"></div><div class="sk-body"><i></i><i></i><i style="width:80%"></i><i></i></div></div>`).join("")}</div>`;
    }
    if (menu.status === "error") {
      return `<div class="state-box" role="alert"><h2>We couldn't load the menu</h2><p>Check your connection and try again. Your basket is saved.</p><button class="btn btn-green" type="button" data-retry>Try again</button></div>`;
    }
    if (menuItems().length === 0) {
      const delivery = getContext().mode === "delivery";
      return `<div class="state-box"><h2>Nothing on the menu ${delivery && getContext().areaId ? `for ${esc(areaLabel().label)} ` : ""}yet</h2><p>The kitchen is updating today's menu. Please check back shortly.</p><div class="state-actions"><button class="btn btn-green" type="button" data-retry>Refresh</button></div></div>`;
    }
    const needle = query.trim().toLowerCase();
    const matching = categories()
      .filter((name) => category === "All" || name === category)
      .map((name) => ({
        name,
        items: menuItems().filter((item) => item.category === name && (!needle || `${item.name} ${item.description}`.toLowerCase().includes(needle))),
      }));
    const hiddenCount = matching.reduce((total, group) => total + group.items.filter((item) => !visible(item)).length, 0);
    const groups = matching.map((group) => ({ ...group, items: group.items.filter(visible) })).filter((group) => group.items.length);
    const hiddenNote = hiddenCount ? `<p class="muted" style="margin:0;font-size:14px">${hiddenCount === 1 ? "1 dish" : `${hiddenCount} dishes`} hidden by your allergen filter. <button class="link-btn" type="button" data-clear-allergens style="min-height:32px">Show all</button></p>` : "";
    if (!groups.length && hiddenCount) {
      return `<div class="state-box plain" role="status"><h2>Nothing to show</h2><p>Your allergen filter is hiding every dish here.</p><button class="btn btn-outline" type="button" data-clear-allergens>Clear the filter</button></div>`;
    }
    if (!groups.length) {
      return `<div class="state-box plain" role="status"><h2>${needle ? `Nothing matches “${esc(query.trim())}”` : `No ${esc(category.toLowerCase())} right now`}</h2><p>${needle ? "Try a different word, like “suya”, “chicken” or “beef”." : "Check back soon, or browse the full menu."}</p><button class="btn btn-outline" type="button" data-reset>Show the full menu</button></div>`;
    }
    let index = 0;
    return `<div class="menu-groups">${groups.map((group) => `
      <section class="menu-group" aria-labelledby="cat-${esc(group.name)}">
        <h2 id="cat-${esc(group.name)}">${esc(group.name)}</h2>
        <div class="menu-grid">${group.items.map((item) => card(item, index++)).join("")}</div>
      </section>`).join("")}${hiddenNote}</div>`;
  };

  const tabsMarkup = (): string => {
    const names = getMenu().status === "live" ? ["All", ...categories()] : ["All"];
    return names.map((name) => `<button class="chip" type="button" role="tab" aria-selected="${category === name}" data-category="${esc(name)}">${esc(name)}</button>`).join("");
  };

  const kicker = (): string => {
    const context = getContext();
    if (context.mode === "pickup") return `Pickup · ${areaLabel().label}`;
    return context.areaId ? `Delivering to ${areaLabel().label}` : "Delivery";
  };

  const renderList = (): void => {
    view.querySelector("[data-menu-list]")!.innerHTML = listMarkup();
    view.querySelector("[data-cat-tabs]")!.innerHTML = tabsMarkup();
    view.querySelector("[data-kicker]")!.textContent = kicker();
  };

  view.innerHTML = `
    <section class="wrap menu-page view">
      <div class="menu-head">
        <div>
          <p class="kicker" data-kicker>${esc(kicker())}</p>
          <h1 class="page-title" tabindex="-1" data-page-heading>Menu</h1>
        </div>
        <div class="menu-tools">
          <div class="search" role="search">
            <input type="search" placeholder="Search the menu" aria-label="Search the menu" data-search autocomplete="off" />
            <button type="button" aria-label="Clear search" data-clear hidden>×</button>
          </div>
          <button class="btn btn-outline btn-sm" type="button" data-allergens aria-haspopup="dialog">${hiddenAllergens.size ? `Allergens · ${hiddenAllergens.size}` : "Allergens"}</button>
        </div>
      </div>
      ${getContext().mode === "delivery" && !getContext().areaId ? `<p class="notice info" style="margin:16px 0 0;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px">Tell us your area to see delivery times and the minimum order.<button class="link-btn" type="button" data-choose-area>Choose your area</button></p>` : ""}
      <div class="cat-tabs" role="tablist" aria-label="Categories" data-cat-tabs>${tabsMarkup()}</div>
      <div data-menu-list aria-live="polite">${listMarkup()}</div>
    </section>`;

  const search = view.querySelector<HTMLInputElement>("[data-search]")!;
  const clear = view.querySelector<HTMLButtonElement>("[data-clear]")!;
  const onInput = (): void => {
    query = search.value;
    clear.hidden = !query;
    view.querySelector("[data-menu-list]")!.innerHTML = listMarkup();
  };
  search.addEventListener("input", onInput);

  const onClick = (event: Event): void => {
    const target = event.target as HTMLElement;
    const tab = target.closest<HTMLElement>("[data-category]");
    if (tab) {
      category = tab.dataset.category!;
      const url = category === "All" ? "/menu" : `/menu?category=${encodeURIComponent(category)}`;
      window.history.replaceState({}, "", url);
      renderList();
      view.querySelector<HTMLElement>(`[data-category="${CSS.escape(category)}"]`)?.focus();
      return;
    }
    if (target.closest("[data-clear]")) {
      search.value = "";
      onInput();
      search.focus();
      return;
    }
    if (target.closest("[data-reset]")) {
      search.value = "";
      query = "";
      clear.hidden = true;
      category = "All";
      window.history.replaceState({}, "", "/menu");
      renderList();
      return;
    }
    if (target.closest("[data-retry]")) return void loadMenu(true);
    if (target.closest("[data-clear-allergens]")) return setHidden(new Set());
    if (target.closest("[data-allergens]")) return openAllergenSheet(menuItems(), hiddenAllergens, allergenList, setHidden);
    if (target.closest("[data-choose-area]")) return openAreaSheet({ mode: "delivery", then: () => navigate("/menu", { replace: true }) });
    const add = target.closest<HTMLElement>("[data-add]");
    if (add) {
      const item = menuItems().find((candidate) => candidate.id === add.dataset.add);
      if (item) quickAdd(item);
      return;
    }
    const configure = target.closest<HTMLElement>("[data-configure]");
    if (configure) {
      const item = menuItems().find((candidate) => candidate.id === configure.dataset.configure);
      if (item) openItemSheet(item);
    }
  };
  view.addEventListener("click", onClick);

  function setHidden(next: Set<string>): void {
    hiddenAllergens = next;
    try {
      sessionStorage.setItem(allergenStorageKey, JSON.stringify([...next]));
    } catch {
      // The filter still applies for this page.
    }
    const button = view.querySelector<HTMLElement>("[data-allergens]");
    if (button) button.textContent = next.size ? `Allergens · ${next.size}` : "Allergens";
    view.querySelector("[data-menu-list]")!.innerHTML = listMarkup();
  }

  // Deals link here with ?voucher=CODE; the basket applies it and the quote confirms it.
  const voucher = new URLSearchParams(window.location.search).get("voucher");
  if (voucher && /^[A-Z0-9]{2,30}$/i.test(voucher)) {
    setVoucherCode(voucher);
    window.history.replaceState({}, "", category === "All" ? "/menu" : `/menu?category=${encodeURIComponent(category)}`);
    showToast({ text: `${voucher.toUpperCase()} will be applied to your basket.` });
  }

  const stopMenu = onMenuChange(renderList);
  const stopContext = onContextChange(() => {
    view.querySelector("[data-kicker]")!.textContent = kicker();
  });
  return () => {
    stopMenu();
    stopContext();
    view.removeEventListener("click", onClick);
  };
}
