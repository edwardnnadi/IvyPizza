import "./shop.css";
import { initAccount, onAccountChange } from "./account.js";
import { onBasketChange } from "./basket.js";
import { mountHeader, renderHeader } from "./header.js";
import { loadMenu, onMenuChange } from "./menu-data.js";
import { onContextChange } from "./order-context.js";
import { loadConfig, onConfigChange } from "./zones.js";
import { onRouteChange, parseRoute, startRouter, type Route } from "./router.js";
import { closeSheet, mountSheet } from "./sheets.js";
import { hideToast, mountToast } from "./toast.js";
import { renderLanding } from "./pages/landing.js";
import { renderMenu } from "./pages/menu.js";
import { renderBuilder } from "./pages/builder.js";
import { renderBasket } from "./pages/basket.js";
import { renderCheckout } from "./pages/checkout.js";
import { renderConfirmation, renderNotFound, renderTracker } from "./pages/order.js";
import { renderAuth } from "./pages/auth.js";
import { renderAccountPage } from "./pages/account-page.js";
import { renderHelp } from "./pages/help.js";

const titles: Record<Route["name"], string> = {
  landing: "The Ivy Pizza | Pizza & burgers delivered in Abuja",
  menu: "Menu | The Ivy Pizza",
  builder: "Build your pizza | The Ivy Pizza",
  basket: "Your basket | The Ivy Pizza",
  checkout: "Checkout | The Ivy Pizza",
  confirmation: "Order received | The Ivy Pizza",
  tracker: "Track your order | The Ivy Pizza",
  auth: "Your account | The Ivy Pizza",
  account: "Your account | The Ivy Pizza",
  help: "Help | The Ivy Pizza",
  notFound: "Page not found | The Ivy Pizza",
};

function renderError(view: HTMLElement): void {
  view.innerHTML = `<section class="wrap view"><div class="state-box" style="margin-top:64px" role="alert"><p class="kicker">Something went wrong</p><h1 tabindex="-1" data-page-heading style="font-size:34px">We hit a problem loading this page</h1><p>Your basket is safe. Try again, and if it keeps happening, let us know.</p><div class="state-actions"><button class="btn btn-gold" type="button" data-reload>Try again</button><a class="btn btn-outline" href="/help">Contact us</a></div></div></section>`;
  view.querySelector("[data-reload]")?.addEventListener("click", () => window.location.reload());
}

export function startStorefront(app: HTMLElement): void {
  app.innerHTML = `
    <div class="shop">
      <a class="skip-link" href="#main">Skip to content</a>
      <header class="hdr" id="hdr"></header>
      <div class="offline-banner" role="status" hidden>You're offline. We'll reconnect when your signal comes back; your basket is saved.</div>
      <main id="main" tabindex="-1"></main>
      <footer class="shop-footer">
        <div class="wrap">
          <a class="brand" href="/">THE IVY <span>PIZZA</span></a>
          <nav aria-label="Footer"><a href="/menu">Menu</a><a href="/track">Track an order</a><a href="/account">My account</a><a href="/help">Help</a></nav>
          <p>Pizza, flame-grilled burgers and fast delivery in Abuja. Open daily 11:00–23:00.</p>
        </div>
      </footer>
      <div id="toast-root"></div>
      <dialog id="sheet" class="sheet"></dialog>
    </div>`;

  const view = app.querySelector<HTMLElement>("#main")!;
  mountToast(app.querySelector<HTMLElement>("#toast-root")!);
  mountSheet(app.querySelector<HTMLDialogElement>("#sheet")!);
  initAccount();
  mountHeader(app.querySelector<HTMLElement>("#hdr")!);

  // Email confirmation links that have expired come back with ?error=…
  const verifyError = new URLSearchParams(window.location.search).get("error");
  if (verifyError && /token|expired|invalid/i.test(verifyError)) window.history.replaceState({}, "", "/verify-email?expired=1");

  const offline = app.querySelector<HTMLElement>(".offline-banner")!;
  const updateOnline = () => {
    offline.hidden = navigator.onLine;
    if (navigator.onLine) {
      void loadConfig();
      if (parseRoute().name !== "checkout") void loadMenu();
    }
  };
  window.addEventListener("online", updateOnline);
  window.addEventListener("offline", updateOnline);
  offline.hidden = navigator.onLine;

  let cleanup: (() => void) | void;
  let firstRender = true;

  const show = (route: Route): void => {
    try {
      cleanup?.();
    } catch {
      // A page that fails to clean up must not block the next one.
    }
    cleanup = undefined;
    closeSheet();
    if (!firstRender) hideToast();
    document.title = titles[route.name];
    try {
      switch (route.name) {
        case "landing": cleanup = renderLanding(view); break;
        case "menu": cleanup = renderMenu(view, route.category); break;
        case "builder": cleanup = renderBuilder(view, route.slug, route.editIndex); break;
        case "basket": cleanup = renderBasket(view); break;
        case "checkout": cleanup = renderCheckout(view); break;
        case "confirmation": cleanup = renderConfirmation(view, route.orderNumber); break;
        case "tracker": cleanup = renderTracker(view, route.orderNumber); break;
        case "auth": cleanup = renderAuth(view, route.page); break;
        case "account": cleanup = renderAccountPage(view, route.tab); break;
        case "help": cleanup = renderHelp(view); break;
        default: renderNotFound(view);
      }
    } catch (error) {
      console.error(error);
      renderError(view);
    }
    if (!firstRender) {
      window.scrollTo({ top: 0 });
      // Move focus to the new page's heading so screen readers announce the change.
      view.querySelector<HTMLElement>("[data-page-heading]")?.focus({ preventScroll: true });
    }
    firstRender = false;
  };

  onRouteChange(show);
  for (const subscribe of [onContextChange, onBasketChange, onAccountChange, onMenuChange, onConfigChange]) subscribe(renderHeader);
  // Opening hours change while the page is open; slots and pauses come from the API.
  window.setInterval(renderHeader, 60_000);
  window.setInterval(() => void loadConfig(), 5 * 60_000);

  startRouter();
  void loadMenu();
  void loadConfig();
  show(parseRoute());

}
