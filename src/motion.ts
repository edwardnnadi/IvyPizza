// Motion layer for the public site. Timings and easing follow the design's motion spec
// (design-handoff/source/Ivy Pizza Design Spec.dc.html). Everything here is optional polish:
// with prefers-reduced-motion the page renders fully static and stays orderable.

export const EASE_OUT_EXPO = "cubic-bezier(.16,1,.3,1)";
const EASE_IN_OUT = "cubic-bezier(.65,0,.35,1)";

const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const narrowQuery = window.matchMedia("(max-width: 759px)");

export function prefersReducedMotion(): boolean {
  return reducedMotionQuery.matches;
}

export function isNarrow(): boolean {
  return narrowQuery.matches;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** Scale bump used on the basket count and floating bar after an add. */
export function bump(element: Element | null): void {
  if (!element || prefersReducedMotion()) return;
  element.animate(
    [{ transform: "scale(1)" }, { transform: "scale(1.25)" }, { transform: "scale(1)" }],
    { duration: 480, easing: EASE_OUT_EXPO },
  );
}

/** A gold dot flies on an arc from the add button to the basket target, then the target bumps. */
export function flyToBasket(from: Element | null, to: Element | null): void {
  if (prefersReducedMotion() || !from || !to) {
    bump(to);
    return;
  }
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  if (b.width === 0 && b.height === 0) return;
  const dot = document.createElement("div");
  dot.className = "fly-dot";
  dot.style.left = `${a.left + a.width / 2 - 9}px`;
  dot.style.top = `${a.top + a.height / 2 - 9}px`;
  document.body.append(dot);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const lift = Math.min(160, Math.abs(dx) * 0.3 + 60);
  const flight = dot.animate([
    { transform: "translate(0,0) scale(.6)", opacity: 0 },
    { transform: `translate(${dx * 0.15}px,${dy * 0.15 - lift * 0.6}px) scale(1.1)`, opacity: 1, offset: 0.2 },
    { transform: `translate(${dx * 0.6}px,${dy * 0.6 - lift}px) scale(1)`, offset: 0.6 },
    { transform: `translate(${dx}px,${dy}px) scale(.35)`, opacity: 0.7 },
  ], { duration: 720, easing: "cubic-bezier(.45,0,.55,1)" });
  flight.onfinish = () => {
    dot.remove();
    bump(to);
  };
}

/** FLIP: cards that stay slide from their old slot; new cards fade and scale in. */
export function flipCards(grid: HTMLElement, before: Map<string, DOMRect>): void {
  if (prefersReducedMotion()) return;
  let entering = 0;
  grid.querySelectorAll<HTMLElement>("[data-card-id]").forEach((card) => {
    const first = before.get(card.dataset.cardId ?? "");
    const last = card.getBoundingClientRect();
    if (first) {
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (dx || dy) {
        card.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], { duration: 600, easing: EASE_IN_OUT });
      }
    } else {
      card.animate(
        [{ opacity: 0, transform: "translateY(28px) scale(.96)" }, { opacity: 1, transform: "none" }],
        { duration: 550, delay: 120 + entering * 60, easing: EASE_OUT_EXPO, fill: "backwards" },
      );
      entering += 1;
    }
  });
}

let revealObserver: IntersectionObserver | null = null;
const revealCallbacks = new WeakMap<Element, () => void>();

function observeReveal(element: Element, onEnter: () => void): void {
  revealObserver ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      revealObserver?.unobserve(entry.target);
      revealCallbacks.get(entry.target)?.();
      revealCallbacks.delete(entry.target);
    }
  }, { rootMargin: "0px 0px -12% 0px" });
  revealCallbacks.set(element, onEnter);
  revealObserver.observe(element);
}

function isBelowFold(element: Element): boolean {
  return element.getBoundingClientRect().top >= window.innerHeight * 0.9;
}

/** First view of the menu grid: cards fade and rise with a 70ms stagger. */
export function revealCardsOnEnter(grid: HTMLElement): void {
  if (prefersReducedMotion() || !isBelowFold(grid)) return;
  const cards = () => grid.querySelectorAll<HTMLElement>("[data-card-id]");
  cards().forEach((card) => (card.style.opacity = "0"));
  observeReveal(grid, () => {
    cards().forEach((card, index) => {
      card.style.opacity = "";
      card.animate(
        [{ opacity: 0, transform: "translateY(40px)" }, { opacity: 1, transform: "none" }],
        { duration: 850, delay: index * 70, easing: EASE_OUT_EXPO, fill: "backwards" },
      );
    });
  });
}

export function initializeMotion(): void {
  const nav = document.querySelector<HTMLElement>("#site-nav");
  const hero = document.querySelector<HTMLElement>("#hero");
  const heroMedia = document.querySelector<HTMLElement>("#hero-media");
  const heroCopy = document.querySelector<HTMLElement>("#hero-copy");
  const expPinned = document.querySelector<HTMLElement>("#exp-pinned");
  const expA = document.querySelector<HTMLElement>("#exp-a");
  const expB = document.querySelector<HTMLElement>("#exp-b");
  const expT1 = document.querySelector<HTMLElement>("#exp-t1");
  const expT2 = document.querySelector<HTMLElement>("#exp-t2");
  const expBar = document.querySelector<HTMLElement>("#exp-bar");
  const capA = document.querySelector<HTMLElement>("#exp-cap-a");
  const capB = document.querySelector<HTMLElement>("#exp-cap-b");
  const visitPar = document.querySelector<HTMLElement>("#visit-par");
  const menu = document.querySelector<HTMLElement>("#menu");
  const pill = document.querySelector<HTMLButtonElement>("#basket-pill");

  if (!prefersReducedMotion()) {
    document.querySelector("#hero-zoom")?.animate(
      [{ transform: "scale(1.1)" }, { transform: "scale(1)" }],
      { duration: 2600, easing: EASE_OUT_EXPO, fill: "forwards" },
    );
    document.querySelectorAll("[data-line]").forEach((line, index) => line.animate(
      [{ transform: "translateY(110%)" }, { transform: "translateY(0)" }],
      { duration: 1100, delay: 250 + index * 130, easing: EASE_OUT_EXPO, fill: "both" },
    ));
    document.querySelectorAll("[data-intro]").forEach((element, index) => element.animate(
      [{ opacity: 0, transform: "translateY(18px)" }, { opacity: 1, transform: "none" }],
      { duration: 900, delay: 650 + index * 110, easing: EASE_OUT_EXPO, fill: "both" },
    ));
    document.querySelectorAll<HTMLElement>("[data-reveal]").forEach((element) => {
      if (!isBelowFold(element)) return;
      element.style.opacity = "0";
      observeReveal(element, () => {
        element.style.opacity = "";
        element.animate(
          [{ opacity: 0, transform: "translateY(36px)" }, { opacity: 1, transform: "none" }],
          { duration: 950, easing: EASE_OUT_EXPO, fill: "backwards" },
        );
      });
    });
  }

  function paintHero(scrollY: number): void {
    if (!hero || scrollY > hero.offsetHeight * 1.2) return;
    if (heroMedia) heroMedia.style.transform = `translate3d(0,${scrollY * 0.35}px,0)`;
    if (heroCopy) {
      const progress = Math.min(scrollY / (hero.offsetHeight * 0.75), 1);
      heroCopy.style.opacity = String(1 - progress);
      heroCopy.style.transform = `translate3d(0,${scrollY * 0.12}px,0)`;
    }
  }

  function paintExperience(progress: number): void {
    const blend = clamp01((progress - 0.38) / 0.24);
    const eased = blend < 0.5 ? 4 * blend ** 3 : 1 - (-2 * blend + 2) ** 3 / 2;
    if (expA) expA.style.transform = `scale(${1.08 - 0.08 * progress})`;
    if (expB) expB.style.clipPath = `inset(${(1 - eased) * 100}% 0 0 0)`;
    if (expT1) {
      expT1.style.opacity = String(1 - eased);
      expT1.style.transform = `translate3d(0,${-eased * 40}px,0)`;
      expT1.style.visibility = eased > 0.98 ? "hidden" : "visible";
    }
    if (expT2) {
      expT2.style.opacity = String(eased);
      expT2.style.transform = `translate3d(0,${(1 - eased) * 40}px,0)`;
      expT2.style.visibility = eased < 0.02 ? "hidden" : "visible";
    }
    if (expBar) expBar.style.transform = `scaleX(${progress})`;
    capA?.classList.toggle("is-on", eased < 0.5);
    capB?.classList.toggle("is-on", eased >= 0.5);
  }

  let pillVisible = false;
  function frame(): void {
    const scrollY = window.scrollY;
    const viewport = window.innerHeight;
    nav?.classList.toggle("is-solid", scrollY > 30);

    if (!prefersReducedMotion()) {
      paintHero(scrollY);
      if (expPinned) {
        const rect = expPinned.getBoundingClientRect();
        if (rect.height > viewport && rect.top < viewport && rect.bottom > 0) {
          paintExperience(clamp01(-rect.top / (rect.height - viewport)));
        }
      }
      if (visitPar?.parentElement) {
        const rect = visitPar.parentElement.getBoundingClientRect();
        const center = Math.max(-1, Math.min(1, (rect.top + rect.height / 2 - viewport / 2) / viewport));
        visitPar.style.transform = `translate3d(0,${center * -6}%,0)`;
      }
    }

    let inMenu = false;
    if (menu) {
      const rect = menu.getBoundingClientRect();
      inMenu = rect.top < viewport * 0.5 && rect.bottom > viewport * 0.5;
    }
    const showPill = scrollY > viewport * 0.7 && (isNarrow() || !inMenu);
    if (pill && showPill !== pillVisible) {
      pillVisible = showPill;
      pill.classList.toggle("is-visible", showPill);
      pill.setAttribute("aria-hidden", String(!showPill));
      pill.tabIndex = showPill ? 0 : -1;
    }
  }

  let scheduled = false;
  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      frame();
    });
  };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  reducedMotionQuery.addEventListener("change", () => {
    if (prefersReducedMotion()) {
      [heroMedia, heroCopy, visitPar, expA, expB, expT1, expT2].forEach((element) => element?.removeAttribute("style"));
    }
    schedule();
  });
  frame();
}

/** Whether the floating basket bar is currently on screen (fly-to target choice). */
export function isPillVisible(): boolean {
  return document.querySelector("#basket-pill")?.classList.contains("is-visible") ?? false;
}
