// Constraint-based selection.
//
// Taking payment is a commodity: anyone can charge 40 EUR. What almost nobody
// does is answer "which gift for Timmy, 6, loves dinosaurs, 40 EUR max, no
// batteries, delivered before the 24th".
//
// This file knows no merchant. Hand it a catalogue, it returns a reasoned
// pick. Wiring a real shop means writing an adapter that emits this shape.

import { units } from './openmandate.js';

const fmt = u => (Number(u) / 1e6).toFixed(2);

/**
 * @typedef {object} Item
 * @property {string} id
 * @property {string} name
 * @property {{amount:string,currency:string}} price
 * @property {number} [ageMin]
 * @property {number} [ageMax]
 * @property {string[]} [tags]
 * @property {boolean} [inStock]
 * @property {number} [leadDays]
 * @property {string} [marchand]
 */

/** Hard filters. An item that fails here is out, never "partly" kept. */
function hardFilter(item, p) {
  if (item.inStock === false) return 'out of stock';
  if (p.age != null) {
    if (item.ageMin != null && p.age < item.ageMin) return `from age ${item.ageMin}`;
    if (item.ageMax != null && p.age > item.ageMax) return `up to age ${item.ageMax}`;
  }
  if (p.maxLeadDays != null && item.leadDays != null && item.leadDays > p.maxLeadDays) {
    return `ships in ${item.leadDays}d, too late`;
  }
  const tags = item.tags || [];
  const banned = (p.avoid || []).find(x => tags.includes(x));
  if (banned) return `excluded: ${banned}`;
  if (p.budget && units(item.price) > units(p.budget)) {
    return `${item.price.amount} > budget ${p.budget.amount}`;
  }
  return null;
}

/** Score doux : uniquement sur ce qui remaining apres les filtres durs. */
function softScore(item, p) {
  const tags = item.tags || [];
  const matched = (p.likes || []).filter(t => tags.includes(t));
  let score = matched.length * 10;
  const reasons = [];
  if (matched.length) reasons.push(`likes ${matched.join(', ')}`);

  // Using the budget well beats wasting it, without ever exceeding it:
  // 0 to 6 points for the share of the budget consumed.
  // sans jamais le depasser : 0 a 6 points pour la share du budget utilisee.
  if (p.budget) {
    const share = Number(units(item.price)) / Number(units(p.budget));
    score += Math.round(share * 6);
    reasons.push(`${Math.round(share * 100)} % of budget`);
  }
  if (p.age != null && item.ageMin != null && item.ageMax != null) {
    const mid = (item.ageMin + item.ageMax) / 2;
    const gap = Math.abs(p.age - mid);
    if (gap <= 1) { score += 3; reasons.push('pile dans la tranche d\'age'); }
  }
  return { score, reasons };
}

/**
 * @param {Item[]} catalogue
 * @param {object} profile {age, likes[], avoid[], budget, maxLeadDays}
 */
export function choose(catalogue, profile) {
  const rejected = [];
  const eligible = [];

  for (const a of catalogue) {
    const reason = hardFilter(a, profile);
    if (reason) { rejected.push({ item: a, reason }); continue; }
    eligible.push({ item: a, ...softScore(a, profile) });
  }
  eligible.sort((x, y) => y.score - x.score
    || Number(units(y.item.price) - units(x.item.price)));

  return {
    pick: eligible[0] || null,
    alternatives: eligible.slice(1, 4),
    rejected,
    examined: catalogue.length,
    eligible: eligible.length,
  };
}

/**
 * Bundles: what can be taken TOGETHER without exceeding the budget.
 * The question nobody answers and everybody asks. Exact knapsack over
 * integer minor units, for small catalogues.
 */
export function combine(catalogue, profile, { max = 3 } = {}) {
  const candidates = catalogue.filter(a => !hardFilter(a, profile));
  const ceiling = units(profile.budget);
  let best = { items: [], total: 0n, score: -1 };

  const walk = (i, taken, total, score) => {
    if (total > ceiling) return;
    if (score > best.score || (score === best.score && total > best.total)) {
      best = { items: [...taken], total, score };
    }
    if (taken.length === max || i >= candidates.length) return;
    for (let j = i; j < candidates.length; j++) {
      const a = candidates[j];
      taken.push(a);
      walk(j + 1, taken, total + units(a.price), score + softScore(a, profile).score);
      taken.pop();
    }
  };
  walk(0, [], 0n, 0);

  return {
    items: best.items,
    total: fmt(best.total),
    remaining: fmt(ceiling - best.total),
    currency: profile.budget.currency,
  };
}

export { fmt };
