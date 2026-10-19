import type { MenuItem, MenuOption } from "./menu-data.js";
import { itemKind } from "./menu-data.js";
import { esc } from "./format.js";

/**
 * Drawn pizzas and burgers that stand in for food photography until real photos exist.
 * They weigh nothing on mobile data and react live in the builder.
 */

interface Topping { color: string }

const sauces = { tomato: "#b8321f", ivy: "#c4602b", suya: "#8f3b1b" } as const;

const recipe: Array<{ match: RegExp; sauce: string; toppings: string[] }> = [
  { match: /suya/i, sauce: sauces.suya, toppings: ["#6e3318", "#8e3f73", "#3f8a3a"] },
  { match: /chicken/i, sauce: sauces.ivy, toppings: ["#e8c48e", "#f2c933", "#8e3f73"] },
  { match: /beef/i, sauce: sauces.ivy, toppings: ["#5a3420", "#8e3f73", "#3f8a3a"] },
  { match: /pepperoni/i, sauce: sauces.tomato, toppings: ["#b23a25"] },
  { match: /margh?arita/i, sauce: sauces.tomato, toppings: ["#e0563a", "#3f8a3a"] },
];

const extraColours: Array<[RegExp, string]> = [
  [/jalap/i, "#2a5e25"],
  [/pepperoni/i, "#b23a25"],
  [/bacon/i, "#c4553b"],
  [/guac/i, "#7fa443"],
  [/chicken/i, "#e8c48e"],
  [/patty|beef/i, "#5a3420"],
  [/mushroom/i, "#b9a58a"],
  [/onion/i, "#8e3f73"],
];

export function extraColour(option: Pick<MenuOption, "name">): string {
  return extraColours.find(([pattern]) => pattern.test(option.name))?.[1] ?? "#d5a543";
}

function isCheese(option: Pick<MenuOption, "name">): boolean {
  return /mozzarella|cheese/i.test(option.name);
}

function seeded(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function dots(toppings: Topping[], perTopping: number): string {
  let out = "";
  toppings.forEach((topping, index) => {
    for (let i = 0; i < perTopping; i += 1) {
      const seed = (index + 1) * 97 + i * 7;
      const angle = seeded(seed) * Math.PI * 2;
      const radius = 0.07 + Math.sqrt(seeded(seed + 3)) * 0.3;
      const x = (50 + Math.cos(angle) * radius * 100).toFixed(1);
      const y = (50 + Math.sin(angle) * radius * 100).toFixed(1);
      out += `<i class="dot" style="left:${x}%;top:${y}%;background:${topping.color}"></i>`;
    }
  });
  return out;
}

export function pizzaArt(item: Pick<MenuItem, "name">, options: { extras?: MenuOption[]; width?: string; size?: "regular" | "large" | "family" } = {}): string {
  const base = recipe.find((entry) => entry.match.test(item.name)) ?? { sauce: sauces.tomato, toppings: [] as string[] };
  const extras = options.extras ?? [];
  const toppings: Topping[] = [
    ...base.toppings.map((color) => ({ color })),
    ...extras.filter((extra) => !isCheese(extra)).map((extra) => ({ color: extraColour(extra) })),
  ];
  const cheese = extras.some(isCheese) ? 0.88 : 0.6;
  const perTopping = options.size === "family" ? 8 : options.size === "large" ? 7 : 6;
  const width = options.width ? `width:${options.width}` : "";
  return `<div class="pizza-art" style="${width}" aria-hidden="true"><span class="sauce" style="background:${base.sauce};opacity:.85"></span><span class="cheese" style="opacity:${cheese}"></span>${dots(toppings, perTopping)}</div>`;
}

export function burgerArt(): string {
  return `<div class="burger-art" aria-hidden="true"><i class="bun-top"></i><i class="lettuce"></i><i class="cheese-slice"></i><i class="patty"></i><i class="bun-base"></i></div>`;
}

const drinkColours: Array<[RegExp, string]> = [[/chapman/i, "#c2412d"], [/zobo/i, "#7a1f3d"], [/cola|coke/i, "#3b1d12"], [/water/i, "#cfe6f2"]];

export function drinkArt(name: string): string {
  const colour = drinkColours.find(([pattern]) => pattern.test(name))?.[1] ?? "#e3a33b";
  return `<div class="drink-art" aria-hidden="true"><i class="straw"></i><i class="glass" style="--drink:${colour}"></i></div>`;
}

export function sideArt(): string {
  return `<div class="side-art" aria-hidden="true"><i class="sticks"></i><i class="cup"></i></div>`;
}

/** The art block used on menu cards, basket lines and sheets. */
export function itemArt(item: MenuItem, extraClass = ""): string {
  if (itemKind(item) === "pizza" || /pizza/i.test(item.category)) {
    const photoSlug = item.slug || item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return `<div class="art art-pizza ${extraClass}"><img class="pizza-photo" src="/pizzas/${esc(photoSlug)}.png" alt="${esc(item.name)} pizza" loading="lazy" /></div>`;
  }
  if (/burger|wrap/i.test(`${item.category} ${item.name}`)) {
    const photoSlug = item.slug || item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return `<div class="art art-burger ${extraClass}"><img class="food-photo" src="/burgers/${esc(photoSlug)}.png" alt="${esc(item.name)}" loading="lazy" /></div>`;
  }
  if (/drink/i.test(item.category)) {
    const photoSlug = item.slug || item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return `<div class="art art-burger ${extraClass}"><img class="food-photo" src="/drinks/${esc(photoSlug)}.png" alt="${esc(item.name)}" loading="lazy" /></div>`;
  }
  if (/side/i.test(item.category)) {
    const photoSlug = item.slug || item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return `<div class="art art-burger ${extraClass}"><img class="food-photo" src="/sides/${esc(photoSlug)}.png" alt="${esc(item.name)}" loading="lazy" /></div>`;
  }
  return `<div class="art art-other ${extraClass}" aria-hidden="true">${esc(item.name.charAt(0))}</div>`;
}

export function categoryArt(category: string, sample: MenuItem | undefined): string {
  if (sample) return itemArt(sample, "category-photo");
  if (/pizza/i.test(category)) return `<div class="art art-pizza">${pizzaArt({ name: "Ivy Suya" }, { width: "120px" })}</div>`;
  if (/burger/i.test(category)) return `<div class="art art-burger">${burgerArt()}</div>`;
  if (/drink/i.test(category)) return `<div class="art art-burger">${drinkArt("Chapman")}</div>`;
  if (/side/i.test(category)) return `<div class="art art-burger">${sideArt()}</div>`;
  return `<div class="art art-other" aria-hidden="true">${esc(category.charAt(0))}</div>`;
}

const toppingColours: Record<string, string> = {
  chicken: "#e8c48e", suya: "#6e3318", pepperoni: "#b23a25", mince: "#5a3420", bacon: "#c4553b", mushrooms: "#b9a58a",
  onions: "#8e3f73", peppers: "#3f8a3a", sweetcorn: "#f2c933", jalapenos: "#2a5e25", tomatoes: "#e0563a", olives: "#1f1f1f",
};
const sauceColours: Record<string, string> = { tomato: "#b8321f", ivy: "#c4602b", suya: "#8f3b1b", bbq: "#5b2618" };

export function toppingColour(code: string | null): string {
  return (code && toppingColours[code]) ?? "#d5a543";
}

export function sauceColour(code: string | null): string {
  return (code && sauceColours[code]) ?? sauces.tomato;
}

/** The builder's live pizza: toppings land on the half they're placed on, more dots for Extra. */
export function builtPizzaArt(input: {
  toppings: Array<{ colour: string; side: "left" | "whole" | "right"; amount: "light" | "normal" | "extra" }>;
  sauceColour: string;
  sauceAmount: "light" | "normal" | "extra";
  cheese: "none" | "light" | "normal" | "extra";
  width: string;
}): string {
  let out = "";
  input.toppings.forEach((topping, index) => {
    const count = { light: 3, normal: 5, extra: 8 }[topping.amount];
    (topping.side === "whole" ? ["left", "right"] : [topping.side]).forEach((side, sideIndex) => {
      for (let i = 0; i < count; i += 1) {
        const seed = (index + 1) * 97 + sideIndex * 31 + i * 7;
        // Left half spans 90°–270° (screen coordinates), right half the rest.
        const angle = (side === "left" ? Math.PI / 2 : -Math.PI / 2) + (0.08 + seeded(seed) * 0.84) * Math.PI;
        const radius = 0.07 + Math.sqrt(seeded(seed + 3)) * 0.29;
        out += `<i class="dot" style="left:${(50 + Math.cos(angle) * radius * 100).toFixed(1)}%;top:${(50 + Math.sin(angle) * radius * 100).toFixed(1)}%;background:${topping.colour}"></i>`;
      }
    });
  });
  const halves = input.toppings.some((topping) => topping.side !== "whole");
  const sauceOpacity = { light: 0.55, normal: 0.85, extra: 1 }[input.sauceAmount];
  const cheeseOpacity = { none: 0, light: 0.35, normal: 0.6, extra: 0.88 }[input.cheese];
  return `<div class="pizza-art" style="width:${input.width}" aria-hidden="true"><span class="sauce" style="background:${input.sauceColour};opacity:${sauceOpacity}"></span><span class="cheese" style="opacity:${cheeseOpacity}"></span>${out}${halves ? `<span class="half-line"></span>` : ""}</div>`;
}
