import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choose, combine } from '../src/choose.js';

const EUR = a => ({ amount: a, currency: 'EUR' });
const cat = [
  { id:'a', name:'T-Rex',    price:EUR('34.90'), ageMin:4, ageMax:9,  tags:['dinosaurs'],          inStock:true,  leadDays:2 },
  { id:'b', name:'Fouilles', price:EUR('24.50'), ageMin:6, ageMax:12, tags:['dinosaurs','science'],inStock:true,  leadDays:3 },
  { id:'c', name:'Robot',    price:EUR('39.90'), ageMin:6, ageMax:12, tags:['dinosaurs','batteries'],  inStock:true,  leadDays:2 },
  { id:'d', name:'Volcan',   price:EUR('21.90'), ageMin:8, ageMax:14, tags:['science'],             inStock:true,  leadDays:4 },
  { id:'e', name:'Rupture',  price:EUR('10.00'), ageMin:3, ageMax:9,  tags:['dinosaurs'],          inStock:false, leadDays:1 },
  { id:'f', name:'Lent',     price:EUR('12.00'), ageMin:3, ageMax:9,  tags:['dinosaurs'],          inStock:true,  leadDays:9 },
  { id:'g', name:'Cher',     price:EUR('99.00'), ageMin:5, ageMax:9,  tags:['dinosaurs'],          inStock:true,  leadDays:1 },
];
const timmy = { age:6, likes:['dinosaurs','science'], avoid:['batteries'],
                budget:EUR('40.00'), maxLeadDays:5 };

test('choisit l item qui coche le plus de preferences', () => {
  const r = choose(cat, timmy);
  assert.equal(r.pick.item.id, 'b');
});

test('chaque ecart est motive, aucun rejet silencieux', () => {
  const r = choose(cat, timmy);
  const motifs = Object.fromEntries(r.rejected.map(e => [e.item.id, e.reason]));
  assert.match(motifs.c, /excluded: batteries/);
  assert.match(motifs.d, /from age 8/);
  assert.match(motifs.e, /out of stock/);
  assert.match(motifs.f, /too late/);
  assert.match(motifs.g, /budget/);
  assert.equal(r.rejected.length + r.eligible, r.examined);
});

test('le budget est une limite dure, jamais approchee par exces', () => {
  const r = choose(cat, { ...timmy, budget: EUR('20.00') });
  assert.ok(r.pick === null || Number(r.pick.item.price.amount) <= 20);
});

test('un item a exactement le budget passe', () => {
  const r = choose([{ id:'x', name:'Pile-poil', price:EUR('40.00'), tags:['dinosaurs'], inStock:true }], timmy);
  assert.equal(r.pick.item.id, 'x');
});

test('un centime de trop est refuse', () => {
  const r = choose([{ id:'x', name:'Un cent trop', price:EUR('40.01'), tags:['dinosaurs'], inStock:true }], timmy);
  assert.equal(r.pick, null);
  assert.match(r.rejected[0].reason, /budget/);
});

test('sans aucun item eligible, le pick est null et non un mauvais pick', () => {
  const r = choose(cat, { ...timmy, budget: EUR('1.00') });
  assert.equal(r.pick, null);
  assert.equal(r.alternatives.length, 0);
});

test('les alternatives sont classees et distinctes du pick', () => {
  const r = choose(cat, timmy);
  const ids = [r.pick.item.id, ...r.alternatives.map(a => a.item.id)];
  assert.equal(new Set(ids).size, ids.length);
});

test('la combinaison ne depasse jamais le budget', () => {
  for (const b of ['15.00','25.00','40.00','60.00']) {
    const c = combine(cat, { ...timmy, budget: EUR(b) }, { max: 3 });
    assert.ok(Number(c.total) <= Number(b), `${c.total} > ${b}`);
    assert.equal((Number(c.total) + Number(c.remaining)).toFixed(2), Number(b).toFixed(2));
  }
});

test('la combinaison respecte les memes filtres durs', () => {
  const c = combine(cat, timmy, { max: 3 });
  const ids = c.items.map(a => a.id);
  for (const interdit of ['c','d','e','f','g']) assert.ok(!ids.includes(interdit), interdit);
});

test('la combinaison respecte le nombre maximum d items', () => {
  const c = combine(cat, { ...timmy, budget: EUR('200.00') }, { max: 2 });
  assert.ok(c.items.length <= 2);
});

test('la meme demande donne toujours le meme resultat', () => {
  const a = choose(cat, timmy), b = choose(cat, timmy);
  assert.equal(a.pick.item.id, b.pick.item.id);
  assert.deepEqual(a.alternatives.map(x=>x.item.id), b.alternatives.map(x=>x.item.id));
});
