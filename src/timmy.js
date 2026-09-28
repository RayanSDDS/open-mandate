// "Quel jouet pour Timmy ?" — le scenario complet, en francais.
import { choisir, combiner } from './choisir.js';

const EUR = a => ({ amount: a, currency: 'EUR' });
const trait = () => console.log('-'.repeat(72));

// Un catalogue de demonstration. Brancher un vrai marchand = produire ce format.
const CATALOGUE = [
  { id:'JC-1042', nom:'Tyrannosaure articule 40 cm',        prix:EUR('34.90'), ageMin:4, ageMax:9,  tags:['dinosaures','figurine'],            enStock:true,  delaiJours:2 },
  { id:'JC-2210', nom:'Kit fouilles fossiles',              prix:EUR('24.50'), ageMin:6, ageMax:12, tags:['dinosaures','science','construction'], enStock:true, delaiJours:3 },
  { id:'JC-3391', nom:'Puzzle 3D squelette de diplodocus',  prix:EUR('18.00'), ageMin:6, ageMax:10, tags:['dinosaures','puzzle'],              enStock:true,  delaiJours:2 },
  { id:'JC-5580', nom:'Circuit train electrique',           prix:EUR('79.90'), ageMin:5, ageMax:10, tags:['train','piles'],                    enStock:true,  delaiJours:2 },
  { id:'JC-6604', nom:'Robot dinosaure telecommande',       prix:EUR('39.90'), ageMin:6, ageMax:12, tags:['dinosaures','piles','robot'],       enStock:true,  delaiJours:2 },
  { id:'JC-7712', nom:'Livre pop-up sur les dinosaures',    prix:EUR('15.90'), ageMin:3, ageMax:8,  tags:['dinosaures','livre'],               enStock:true,  delaiJours:1 },
  { id:'JC-8830', nom:'Maquette volcan a faire soi-meme',   prix:EUR('21.90'), ageMin:8, ageMax:14, tags:['science','construction'],           enStock:true,  delaiJours:4 },
  { id:'JC-9901', nom:'Coffret figurines dinosaures x12',   prix:EUR('29.90'), ageMin:3, ageMax:8,  tags:['dinosaures','figurine'],            enStock:false, delaiJours:2 },
  { id:'JC-4417', nom:'Trottinette 3 roues',                prix:EUR('44.90'), ageMin:3, ageMax:7,  tags:['exterieur'],                        enStock:true,  delaiJours:9 },
];

const TIMMY = {
  age: 6,
  aime: ['dinosaures', 'science'],
  exclure: ['piles'],
  budget: EUR('40.00'),
  delaiMaxJours: 5,
};

export function run() {
  trait();
  console.log('LA DEMANDE');
  console.log('  "Un cadeau de Noel pour Timmy, 6 ans. Il adore les dinosaures.');
  console.log('   40 euros maximum, pas de jouets a piles, livre avant le 24."');

  trait();
  console.log(`LE CATALOGUE  ${CATALOGUE.length} articles`);

  const r = choisir(CATALOGUE, TIMMY);

  trait();
  console.log('LE CHOIX');
  const c = r.choix;
  console.log(`  ${c.article.nom}`);
  console.log(`  ${c.article.prix.amount} EUR  ·  ref ${c.article.id}`);
  console.log(`  pourquoi : ${c.raisons.join(' · ')}`);

  trait();
  console.log('SI CELUI-LA NE PLAIT PAS');
  for (const a of r.alternatives) {
    console.log(`  ${a.article.prix.amount.padStart(6)} EUR  ${a.article.nom.padEnd(38)} ${a.raisons[0] || ''}`);
  }

  trait();
  console.log(`ECARTES  ${r.ecartes.length} sur ${r.examines}, et on dit pourquoi`);
  for (const e of r.ecartes) {
    console.log(`  ${e.article.nom.padEnd(40)} ${e.motif}`);
  }

  trait();
  console.log('OU ALORS, POUR LE MEME BUDGET, PLUSIEURS CHOSES');
  const combo = combiner(CATALOGUE, TIMMY, { max: 3 });
  for (const a of combo.articles) {
    console.log(`  ${a.prix.amount.padStart(6)} EUR  ${a.nom}`);
  }
  console.log(`  ${'='.repeat(6)}`);
  console.log(`  ${combo.total.padStart(6)} EUR  total, il reste ${combo.reste} EUR`);

  trait();
  console.log('Aucun appel reseau. Aucun modele. Une decision reproductible et motivee.');
  return 0;
}

if (process.argv[2] === 'timmy') process.exit(run());
