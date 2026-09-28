// "Which gift for Timmy?" — the whole scenario.
import { choose, combine } from './choose.js';

const EUR = a => ({ amount: a, currency: 'EUR' });
const rule = () => console.log('-'.repeat(72));

// Sample catalogue. Wiring a real shop means emitting this shape.
// Hosts use the .example TLD reserved by RFC 2606: no brand, no region.
const CATALOGUE = [
  { id:'TOY-1042', name:'Articulated T-rex, 40 cm',      price:EUR('34.90'), ageMin:4, ageMax:9,  tags:['dinosaurs','figure'],              inStock:true,  leadDays:2 },
  { id:'TOY-2210', name:'Fossil excavation kit',         price:EUR('24.50'), ageMin:6, ageMax:12, tags:['dinosaurs','science','building'],  inStock:true,  leadDays:3 },
  { id:'TOY-3391', name:'3D diplodocus skeleton puzzle', price:EUR('18.00'), ageMin:6, ageMax:10, tags:['dinosaurs','puzzle'],              inStock:true,  leadDays:2 },
  { id:'TOY-5580', name:'Electric train set',            price:EUR('79.90'), ageMin:5, ageMax:10, tags:['trains','batteries'],              inStock:true,  leadDays:2 },
  { id:'TOY-6604', name:'Remote-control dinosaur robot', price:EUR('39.90'), ageMin:6, ageMax:12, tags:['dinosaurs','batteries','robot'],   inStock:true,  leadDays:2 },
  { id:'TOY-7712', name:'Pop-up dinosaur book',          price:EUR('15.90'), ageMin:3, ageMax:8,  tags:['dinosaurs','book'],                inStock:true,  leadDays:1 },
  { id:'TOY-8830', name:'Build-your-own volcano model',  price:EUR('21.90'), ageMin:8, ageMax:14, tags:['science','building'],              inStock:true,  leadDays:4 },
  { id:'TOY-9901', name:'Dinosaur figure set of 12',     price:EUR('29.90'), ageMin:3, ageMax:8,  tags:['dinosaurs','figure'],              inStock:false, leadDays:2 },
  { id:'TOY-4417', name:'Three-wheel scooter',           price:EUR('44.90'), ageMin:3, ageMax:7,  tags:['outdoor'],                         inStock:true,  leadDays:9 },
];

const TIMMY = { age:6, likes:['dinosaurs','science'], avoid:['batteries'],
                budget:EUR('40.00'), maxLeadDays:5 };

export function run() {
  rule();
  console.log('THE REQUEST');
  console.log('  "A birthday gift for Timmy, 6. He loves dinosaurs.');
  console.log('   40 EUR at most, nothing that needs batteries, here within 5 days."');

  rule();
  console.log(`THE CATALOGUE  ${CATALOGUE.length} items`);

  const r = choose(CATALOGUE, TIMMY);

  rule();
  console.log('THE PICK');
  console.log(`  ${r.pick.item.name}`);
  console.log(`  ${r.pick.item.price.amount} EUR  ·  ref ${r.pick.item.id}`);
  console.log(`  why: ${r.pick.reasons.join(' · ')}`);

  rule();
  console.log('IF THAT ONE MISSES');
  for (const a of r.alternatives) {
    console.log(`  ${a.item.price.amount.padStart(6)} EUR  ${a.item.name.padEnd(36)} ${a.reasons[0] || ''}`);
  }

  rule();
  console.log(`RULED OUT  ${r.rejected.length} of ${r.examined}, each with its reason`);
  for (const e of r.rejected) {
    console.log(`  ${e.item.name.padEnd(38)} ${e.reason}`);
  }

  rule();
  console.log('OR, FOR THE SAME BUDGET, SEVERAL THINGS');
  const bundle = combine(CATALOGUE, TIMMY, { max: 3 });
  for (const a of bundle.items) console.log(`  ${a.price.amount.padStart(6)} EUR  ${a.name}`);
  console.log(`  ${'='.repeat(6)}`);
  console.log(`  ${bundle.total.padStart(6)} EUR  total, ${bundle.remaining} EUR left`);

  rule();
  console.log('No network call. No model. A reproducible decision that states its reasons.');
  return 0;
}

if (process.argv[2] === 'timmy') process.exit(run());
