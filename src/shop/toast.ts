import { esc } from "./format.js";

export interface ToastAction {
  label: string;
  /** Navigate on click (handled by the router's link interception). */
  href?: string;
  run?: () => void;
  ghost?: boolean;
}

export interface ToastOptions {
  text: string;
  actions?: ToastAction[];
  /** Extra content under the main row, e.g. the one allowed upsell. Already-escaped HTML. */
  extra?: string;
  onExtraClick?: (target: HTMLElement) => void;
  duration?: number;
}

let root: HTMLElement | null = null;
let timer: number | undefined;

export function mountToast(container: HTMLElement): void {
  root = container;
}

export function hideToast(): void {
  window.clearTimeout(timer);
  if (root) root.replaceChildren();
}

export function showToast(options: ToastOptions): void {
  if (!root) return;
  window.clearTimeout(timer);
  const actions = options.actions ?? [];
  root.innerHTML = `
    <div class="toast" role="status">
      <div class="toast-row">
        <strong>${esc(options.text)}</strong>
        <span style="display:flex;gap:8px">${actions.map((action, index) => action.href
          ? `<a class="btn btn-gold ${action.ghost ? "toast-ghost" : ""}" href="${esc(action.href)}" data-toast="${index}">${esc(action.label)}</a>`
          : `<button class="btn btn-gold ${action.ghost ? "toast-ghost" : ""}" type="button" data-toast="${index}">${esc(action.label)}</button>`).join("")}</span>
      </div>
      ${options.extra ?? ""}
    </div>`;
  const toast = root.firstElementChild as HTMLElement;
  toast.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const actionButton = target.closest<HTMLElement>("[data-toast]");
    if (actionButton) {
      actions[Number(actionButton.dataset.toast)]?.run?.();
      hideToast();
      return;
    }
    options.onExtraClick?.(target);
  });
  // Pause while the pointer or focus is inside, so nobody loses an undo they are reaching for.
  const arm = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(hideToast, options.duration ?? 5000);
  };
  toast.addEventListener("pointerenter", () => window.clearTimeout(timer));
  toast.addEventListener("pointerleave", arm);
  toast.addEventListener("focusin", () => window.clearTimeout(timer));
  toast.addEventListener("focusout", arm);
  arm();
}
