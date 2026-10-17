const nairaFormatters = new Map<string, Intl.NumberFormat>();

/** ₦7,500 — amounts are stored in minor units (kobo) and shown without decimals. */
export function money(amountMinor: number, currency = "NGN"): string {
  let formatter = nairaFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 0, minimumFractionDigits: 0 });
    nairaFormatters.set(currency, formatter);
  }
  return formatter.format(amountMinor / 100);
}

const escapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapes text for use inside HTML text or a quoted attribute. Every value from the API passes through this. */
export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => escapes[character]!);
}

/** Tagged template that returns the string unchanged; it only exists so editors highlight the markup. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((out, part, index) => out + part + (index < values.length ? String(values[index] ?? "") : ""), "");
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
