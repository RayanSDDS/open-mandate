// Moteur de choix sous contraintes.
//
// Le paiement est une commodite : tout le monde sait encaisser 40 euros.
// Ce que presque personne ne sait faire, c'est repondre a "quel cadeau pour
// Timmy, 6 ans, dinosaures, 40 euros, pas de piles, livrable avant le 24".
//
// Ce fichier ne connait aucun marchand. On lui passe un catalogue, il rend un
// choix motive. Brancher JoueClub, Carrefour ou une boutique Shopify, c'est
// ecrire un adaptateur qui produit ce format, rien de plus.

import { units } from './openmandate.js';

const fmt = u => (Number(u) / 1e6).toFixed(2);

/**
 * @typedef {object} Article
 * @property {string} id
 * @property {string} nom
 * @property {{amount:string,currency:string}} prix
 * @property {number} [ageMin]
 * @property {number} [ageMax]
 * @property {string[]} [tags]
 * @property {boolean} [enStock]
 * @property {number} [delaiJours]
 * @property {string} [marchand]
 */

/** Filtres durs : un article qui echoue ici est ecarte, jamais "un peu" retenu. */
function filtrer(article, p) {
  if (article.enStock === false) return 'rupture de stock';
  if (p.age != null) {
    if (article.ageMin != null && p.age < article.ageMin) return `des ${article.ageMin} ans`;
    if (article.ageMax != null && p.age > article.ageMax) return `jusqu'a ${article.ageMax} ans`;
  }
  if (p.delaiMaxJours != null && article.delaiJours != null && article.delaiJours > p.delaiMaxJours) {
    return `livre en ${article.delaiJours} j, trop tard`;
  }
  const tags = article.tags || [];
  const interdit = (p.exclure || []).find(x => tags.includes(x));
  if (interdit) return `exclu : ${interdit}`;
  if (p.budget && units(article.prix) > units(p.budget)) {
    return `${article.prix.amount} > budget ${p.budget.amount}`;
  }
  return null;
}

/** Score doux : uniquement sur ce qui reste apres les filtres durs. */
function noter(article, p) {
  const tags = article.tags || [];
  const aimes = (p.aime || []).filter(t => tags.includes(t));
  let score = aimes.length * 10;
  const raisons = [];
  if (aimes.length) raisons.push(`aime ${aimes.join(', ')}`);

  // Un cadeau qui utilise bien le budget vaut mieux qu'un qui le gaspille,
  // sans jamais le depasser : 0 a 6 points pour la part du budget utilisee.
  if (p.budget) {
    const part = Number(units(article.prix)) / Number(units(p.budget));
    score += Math.round(part * 6);
    raisons.push(`${Math.round(part * 100)} % du budget`);
  }
  if (p.age != null && article.ageMin != null && article.ageMax != null) {
    const centre = (article.ageMin + article.ageMax) / 2;
    const ecart = Math.abs(p.age - centre);
    if (ecart <= 1) { score += 3; raisons.push('pile dans la tranche d\'age'); }
  }
  return { score, raisons };
}

/**
 * @param {Article[]} catalogue
 * @param {object} profil {age, aime[], exclure[], budget, delaiMaxJours}
 */
export function choisir(catalogue, profil) {
  const ecartes = [];
  const retenus = [];

  for (const a of catalogue) {
    const motif = filtrer(a, profil);
    if (motif) { ecartes.push({ article: a, motif }); continue; }
    retenus.push({ article: a, ...noter(a, profil) });
  }
  retenus.sort((x, y) => y.score - x.score
    || Number(units(y.article.prix) - units(x.article.prix)));

  return {
    choix: retenus[0] || null,
    alternatives: retenus.slice(1, 4),
    ecartes,
    examines: catalogue.length,
    retenus: retenus.length,
  };
}

/**
 * Combinaisons : ce qu'on peut prendre ENSEMBLE sans depasser le budget.
 * C'est la question que personne ne pose et que tout le monde se pose.
 * Sac a dos exact sur de petits catalogues, en centimes entiers.
 */
export function combiner(catalogue, profil, { max = 3 } = {}) {
  const eligibles = catalogue.filter(a => !filtrer(a, profil));
  const plafond = units(profil.budget);
  let meilleur = { articles: [], total: 0n, score: -1 };

  const explorer = (i, pris, total, score) => {
    if (total > plafond) return;
    if (score > meilleur.score || (score === meilleur.score && total > meilleur.total)) {
      meilleur = { articles: [...pris], total, score };
    }
    if (pris.length === max || i >= eligibles.length) return;
    for (let j = i; j < eligibles.length; j++) {
      const a = eligibles[j];
      pris.push(a);
      explorer(j + 1, pris, total + units(a.prix), score + noter(a, profil).score);
      pris.pop();
    }
  };
  explorer(0, [], 0n, 0);

  return {
    articles: meilleur.articles,
    total: fmt(meilleur.total),
    reste: fmt(plafond - meilleur.total),
    devise: profil.budget.currency,
  };
}

export { fmt };
