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

/** The art block used on menu cards, basket lines and sheets. */
export function itemArt(item: MenuItem, extraClass = ""): string {
  if (itemKind(item) === "pizza" || /pizza/i.test(item.category)) return `<div class="art art-pizza ${extraClass}">${pizzaArt(item)}</div>`;
  if (/burger|wrap/i.test(`${item.category} ${item.name}`)) return `<div class="art art-burger ${extraClass}">${burgerArt()}</div>`;
  return `<div class="art art-other ${extraClass}" aria-hidden="true">${esc(item.name.charAt(0))}</div>`;
}

export function categoryArt(category: string, sample: MenuItem | undefined): string {
  if (/pizza/i.test(category)) return `<div class="art art-pizza">${pizzaArt(sample ?? { name: "Ivy Suya" }, { width: "120px" })}</div>`;
  if (/burger/i.test(category)) return `<div class="art art-burger">${burgerArt()}</div>`;
  return `<div class="art art-other" aria-hidden="true">${esc(category.charAt(0))}</div>`;
}
