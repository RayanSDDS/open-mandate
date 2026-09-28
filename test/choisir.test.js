import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choisir, combiner } from '../src/choisir.js';

const EUR = a => ({ amount: a, currency: 'EUR' });
const cat = [
  { id:'a', nom:'T-Rex',    prix:EUR('34.90'), ageMin:4, ageMax:9,  tags:['dinosaures'],          enStock:true,  delaiJours:2 },
  { id:'b', nom:'Fouilles', prix:EUR('24.50'), ageMin:6, ageMax:12, tags:['dinosaures','science'],enStock:true,  delaiJours:3 },
  { id:'c', nom:'Robot',    prix:EUR('39.90'), ageMin:6, ageMax:12, tags:['dinosaures','piles'],  enStock:true,  delaiJours:2 },
  { id:'d', nom:'Volcan',   prix:EUR('21.90'), ageMin:8, ageMax:14, tags:['science'],             enStock:true,  delaiJours:4 },
  { id:'e', nom:'Rupture',  prix:EUR('10.00'), ageMin:3, ageMax:9,  tags:['dinosaures'],          enStock:false, delaiJours:1 },
  { id:'f', nom:'Lent',     prix:EUR('12.00'), ageMin:3, ageMax:9,  tags:['dinosaures'],          enStock:true,  delaiJours:9 },
  { id:'g', nom:'Cher',     prix:EUR('99.00'), ageMin:5, ageMax:9,  tags:['dinosaures'],          enStock:true,  delaiJours:1 },
];
const timmy = { age:6, aime:['dinosaures','science'], exclure:['piles'],
                budget:EUR('40.00'), delaiMaxJours:5 };

test('choisit l article qui coche le plus de preferences', () => {
  const r = choisir(cat, timmy);
  assert.equal(r.choix.article.id, 'b');
});

test('chaque ecart est motive, aucun rejet silencieux', () => {
  const r = choisir(cat, timmy);
  const motifs = Object.fromEntries(r.ecartes.map(e => [e.article.id, e.motif]));
  assert.match(motifs.c, /piles/);
  assert.match(motifs.d, /8 ans/);
  assert.match(motifs.e, /rupture/);
  assert.match(motifs.f, /trop tard/);
  assert.match(motifs.g, /budget/);
  assert.equal(r.ecartes.length + r.retenus, r.examines);
});

test('le budget est une limite dure, jamais approchee par exces', () => {
  const r = choisir(cat, { ...timmy, budget: EUR('20.00') });
  assert.ok(r.choix === null || Number(r.choix.article.prix.amount) <= 20);
});

test('un article a exactement le budget passe', () => {
  const r = choisir([{ id:'x', nom:'Pile-poil', prix:EUR('40.00'), tags:['dinosaures'], enStock:true }], timmy);
  assert.equal(r.choix.article.id, 'x');
});

test('un centime de trop est refuse', () => {
  const r = choisir([{ id:'x', nom:'Un cent trop', prix:EUR('40.01'), tags:['dinosaures'], enStock:true }], timmy);
  assert.equal(r.choix, null);
  assert.match(r.ecartes[0].motif, /budget/);
});

test('sans aucun article eligible, le choix est null et non un mauvais choix', () => {
  const r = choisir(cat, { ...timmy, budget: EUR('1.00') });
  assert.equal(r.choix, null);
  assert.equal(r.alternatives.length, 0);
});

test('les alternatives sont classees et distinctes du choix', () => {
  const r = choisir(cat, timmy);
  const ids = [r.choix.article.id, ...r.alternatives.map(a => a.article.id)];
  assert.equal(new Set(ids).size, ids.length);
});

test('la combinaison ne depasse jamais le budget', () => {
  for (const b of ['15.00','25.00','40.00','60.00']) {
    const c = combiner(cat, { ...timmy, budget: EUR(b) }, { max: 3 });
    assert.ok(Number(c.total) <= Number(b), `${c.total} > ${b}`);
    assert.equal((Number(c.total) + Number(c.reste)).toFixed(2), Number(b).toFixed(2));
  }
});

test('la combinaison respecte les memes filtres durs', () => {
  const c = combiner(cat, timmy, { max: 3 });
  const ids = c.articles.map(a => a.id);
  for (const interdit of ['c','d','e','f','g']) assert.ok(!ids.includes(interdit), interdit);
});

test('la combinaison respecte le nombre maximum d articles', () => {
  const c = combiner(cat, { ...timmy, budget: EUR('200.00') }, { max: 2 });
  assert.ok(c.articles.length <= 2);
});

test('la meme demande donne toujours le meme resultat', () => {
  const a = choisir(cat, timmy), b = choisir(cat, timmy);
  assert.equal(a.choix.article.id, b.choix.article.id);
  assert.deepEqual(a.alternatives.map(x=>x.article.id), b.alternatives.map(x=>x.article.id));
});
