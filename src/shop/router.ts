export type Route =
  | { name: "landing" }
  | { name: "menu"; category: string | null }
  | { name: "builder"; slug: string; editIndex: number | null }
  | { name: "basket" }
  | { name: "checkout" }
  | { name: "confirmation"; orderNumber: string }
  | { name: "tracker"; orderNumber: string | null }
  | { name: "notFound" };

const listeners = new Set<(route: Route) => void>();

export function parseRoute(location: Location | URL = window.location): Route {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const query = new URLSearchParams(location.search);
  if (path === "/") return { name: "landing" };
  if (path === "/menu") return { name: "menu", category: query.get("category") };
  if (path === "/basket") return { name: "basket" };
  if (path === "/checkout") return { name: "checkout" };
  if (path === "/track") return { name: "tracker", orderNumber: null };
  const builder = /^\/menu\/([a-z0-9-]{1,100})$/i.exec(path);
  if (builder) {
    const edit = Number(query.get("edit"));
    return { name: "builder", slug: builder[1]!, editIndex: query.has("edit") && Number.isInteger(edit) && edit >= 0 ? edit : null };
  }
  const order = /^\/order\/([A-Z0-9-]{1,40})$/i.exec(path);
  if (order) return { name: "confirmation", orderNumber: decodeURIComponent(order[1]!) };
  const track = /^\/track\/([A-Z0-9-]{1,40})$/i.exec(path);
  if (track) return { name: "tracker", orderNumber: decodeURIComponent(track[1]!) };
  return { name: "notFound" };
}

export function navigate(href: string, options: { replace?: boolean } = {}): void {
  const url = new URL(href, window.location.origin);
  const current = window.location.pathname + window.location.search;
  if (url.pathname + url.search !== current) {
    if (options.replace) window.history.replaceState({}, "", url.pathname + url.search);
    else window.history.pushState({}, "", url.pathname + url.search);
  }
  emit();
}

export function onRouteChange(listener: (route: Route) => void): void {
  listeners.add(listener);
}

function emit(): void {
  const route = parseRoute();
  for (const listener of listeners) listener(route);
}

/** Paths that belong to other apps on this origin and need a full page load. */
const externalPaths = /^\/(kitchen|hr|api)(\/|$)/;

export function startRouter(): void {
  window.addEventListener("popstate", emit);
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin || externalPaths.test(url.pathname) || url.protocol === "tel:") return;
    if (url.pathname === window.location.pathname && url.hash) return;
    event.preventDefault();
    navigate(url.pathname + url.search);
  });
}
