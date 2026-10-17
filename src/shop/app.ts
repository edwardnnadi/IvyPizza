import "./shop.css";
import { accountMarkup, initAccount, onAccountChange } from "./account.js";
import { onBasketChange } from "./basket.js";
import { mountHeader, renderHeader } from "./header.js";
import { loadMenu, onMenuChange } from "./menu-data.js";
import { onContextChange } from "./order-context.js";
import { onRouteChange, parseRoute, startRouter, type Route } from "./router.js";
import { closeSheet, mountSheet } from "./sheets.js";
import { hideToast, mountToast } from "./toast.js";
import { renderLanding } from "./pages/landing.js";
import { renderMenu } from "./pages/menu.js";
import { renderBuilder } from "./pages/builder.js";
import { renderBasket } from "./pages/basket.js";
import { renderCheckout } from "./pages/checkout.js";
import { renderConfirmation, renderNotFound, renderTracker } from "./pages/order.js";

const titles: Record<Route["name"], string> = {
  landing: "The Ivy Pizza | Pizza & burgers delivered in Abuja",
  menu: "Menu | The Ivy Pizza",
  builder: "Build your pizza | The Ivy Pizza",
  basket: "Your basket | The Ivy Pizza",
  checkout: "Checkout | The Ivy Pizza",
  confirmation: "Order received | The Ivy Pizza",
  tracker: "Track your order | The Ivy Pizza",
  notFound: "Page not found | The Ivy Pizza",
};

export function startStorefront(app: HTMLElement): void {
  app.innerHTML = `
    <div class="shop">
      <a class="skip-link" href="#main">Skip to content</a>
      <header class="hdr" id="hdr"></header>
      <main id="main" tabindex="-1"></main>
      <footer class="shop-footer">
        <div class="wrap">
          <a class="brand" href="/">THE IVY <span>PIZZA</span></a>
          <nav aria-label="Footer"><a href="/menu">Menu</a><a href="/basket">Basket</a><a href="/">Home</a></nav>
          <p>Pizza, flame-grilled burgers and fast delivery in Abuja. Open daily 11:00–23:00.</p>
        </div>
      </footer>
      <div id="toast-root"></div>
      <dialog id="sheet" class="sheet"></dialog>
      ${accountMarkup}
    </div>`;

  const view = app.querySelector<HTMLElement>("#main")!;
  mountToast(app.querySelector<HTMLElement>("#toast-root")!);
  mountSheet(app.querySelector<HTMLDialogElement>("#sheet")!);
  initAccount();
  mountHeader(app.querySelector<HTMLElement>("#hdr")!);

  let cleanup: (() => void) | void;
  let firstRender = true;

  const show = (route: Route): void => {
    cleanup?.();
    cleanup = undefined;
    closeSheet();
    if (!firstRender) hideToast();
    document.title = titles[route.name];
    switch (route.name) {
      case "landing": cleanup = renderLanding(view); break;
      case "menu": cleanup = renderMenu(view, route.category); break;
      case "builder": cleanup = renderBuilder(view, route.slug, route.editIndex); break;
      case "basket": cleanup = renderBasket(view); break;
      case "checkout": cleanup = renderCheckout(view); break;
      case "confirmation": renderConfirmation(view, route.orderNumber); break;
      case "tracker": cleanup = renderTracker(view, route.orderNumber); break;
      default: renderNotFound(view);
    }
    if (!firstRender) {
      window.scrollTo({ top: 0 });
      // Move focus to the new page's heading so screen readers announce the change.
      view.querySelector<HTMLElement>("[data-page-heading]")?.focus({ preventScroll: true });
    }
    firstRender = false;
  };

  onRouteChange(show);
  for (const subscribe of [onContextChange, onBasketChange, onAccountChange, onMenuChange]) subscribe(renderHeader);
  // Opening hours change while the page is open.
  window.setInterval(renderHeader, 60_000);

  startRouter();
  void loadMenu();
  show(parseRoute());
}
