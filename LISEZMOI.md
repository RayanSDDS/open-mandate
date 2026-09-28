# open-mandate

*[English version](README.md)*

**Une autorisation signée qu'un agent IA peut présenter, et que n'importe qui peut vérifier hors ligne.**

Un agent demande : *puis-je payer 149,90 € chez hardware.example ?*
`open-mandate` répond `allow`, `needs_human` ou `deny`, et dit exactement quelle
contrainte a bloqué. Sans compte, sans appel réseau, sans prestataire de paiement.

## Essayer en 15 secondes

Aucune dépendance. Node 18 ou plus suffit.

```bash
git clone https://github.com/RayanSDDS/open-mandate && cd open-mandate
npm run demo    # 18 vérifications
npm run shop    # un achat de bout en bout, sans validation humaine
npm run timmy   # "quel cadeau pour Timmy, 6 ans, 40 euros ?"
npm test        # 54 tests
```

Rien n'est téléchargé : la cryptographie vient de `node:crypto`.

## Pourquoi ça existe

On confie aux agents IA un pouvoir de dépense plus vite qu'on ne définit les
limites de ce pouvoir. Aujourd'hui il n'y a que deux réponses : soit l'humain
valide chaque achat, soit l'agent a une carte et on croise les doigts. Il manque
un objet portable et lisible qui dise *cet agent, ces marchands, ce montant,
jusqu'à cette date, et au-dessus de cette somme tu me demandes d'abord.*

C'est cet objet.

Il **ne déplace pas d'argent**. Il autorise. Le règlement reste là où il est
déjà : une carte, un prestataire, un virement.

## Les quatre morceaux

**Le mandat** — un JSON signé en Ed25519. L'humain le signe une fois.

**Le vérificateur** — `decide()` répond `allow`, `needs_human` ou `deny`, et
nomme chaque contrainte qui a échoué. Hors ligne.

**La preuve de détention** — l'agent signe chaque demande avec sa propre clé,
liée à ce mandat, ce montant et ce marchand précis. Sans elle le mandat serait
un jeton au porteur : copier le fichier suffirait pour dépenser.

**Le marchand** — il vérifie la signature, contrôle que l'agent détient bien sa
clé, applique les limites contre **son propre livre** et non celui de l'agent,
puis contresigne. C'est la moitié du protocole que personne d'autre ne publie.

## Ce que ça donne

```
ETAPE 1  L'humain signe UNE fois. Plus jamais ensuite.
         <= 500 EUR/achat | <= 1500 EUR au total | humain au-dela de 200 EUR

ETAPE 2  "Achete-moi ca." L'agent achete seul. Aucune validation demandee.
  OK   Mixer tap               89.90 EUR        authorized
  OK   Floor tiles 6 m2        149.90 EUR        authorized
  OK   Silicone sealant          7.40 EUR        authorized

ETAPE 3  Au-dessus du seuil, l'humain revient dans la boucle.
  OK   Shower enclosure      350.00 EUR        needs_human

ETAPE 4  Un voleur copie le fichier du mandat.
  OK   achat avec le mandat vole               declined

ETAPE 5  Les deux parties tiennent des comptes independants.
         livre du marchand : 3 commandes, 247.20 EUR
         livre de l'agent  : 3 recus,     247.20 EUR
```

## Le moteur de choix

Encaisser 40 €, tout le monde sait faire. Répondre à *« quel cadeau pour Timmy,
6 ans, dinosaures, 40 € maximum, pas de piles, livré avant le 24 »*, presque
personne.

`src/choisir.js` ne connaît aucun marchand. On lui passe un catalogue, il rend
un choix motivé, des alternatives, et surtout **la liste de ce qu'il a écarté
avec le motif**. Brancher un vrai marchand, c'est écrire un adaptateur qui
produit ce format.

```
LE CHOIX
  Kit fouilles fossiles — 24.50 EUR
  pourquoi : aime dinosaures, science · 61 % du budget

ECARTES  5 sur 9, et on dit pourquoi
  Circuit train electrique          exclu : piles
  Maquette volcan                   des 8 ans
  Coffret figurines                 rupture de stock
  Trottinette 3 roues               livre en 9 j, trop tard
```

Il sait aussi composer : plusieurs articles pour le même budget, sans jamais le
dépasser d'un centime.

## Trois décisions qui font la différence

**JSON canonique, pas `JSON.stringify`.** Les clés sont triées récursivement
avant signature. Un marchand peut relire le mandat, le resérialiser, le faire
passer par une file d'attente, la signature tient toujours. La plupart des
implémentations maison sautent cette étape et cassent dès qu'on touche au
document.

**Le seuil d'accord humain est appliqué, pas déclaré.** `human_above` n'est pas
de la documentation. Le vérificateur renvoie `needs_human` et l'appelant ne peut
pas continuer. Une limite que personne ne contrôle est un décor.

**Les reçus sont chaînés par empreinte.** Chaque action produit un reçu signé
qui engage l'empreinte du précédent. Modifier un montant, supprimer une ligne,
inverser l'ordre : `audit` le voit. Une action sans reçu n'a pas eu lieu.

Cette troisième décision vient d'une observation de terrain : un modèle local
qui écrit *« fichier vérifié »* à propos d'un fichier qu'il n'a jamais créé. Les
agents affirment. Les reçus prouvent.

## À côté de Visa, Stripe et Google

Le Trusted Agent Protocol de Visa, les Shared Payment Tokens de Stripe et AP2 de
Google existent, sont publiés, et résolvent la partie qu'`open-mandate` laisse
volontairement de côté : déplacer l'argent.

Celui-ci est l'autorisation qui peut se placer devant n'importe lequel d'entre
eux. Il vaut le coup quand on veut : aucune dépendance, une vérification
entièrement hors ligne sans compte chez qui que ce soit, un seuil d'accord
humain de premier rang, une piste d'audit infalsifiable, et des montants en
chaînes décimales calculés en entiers, jamais en flottants.

Aucune affirmation n'est faite ici sur ce que ces trois protocoles font ou ne
font pas : lisez leurs spécifications. L'argument est ailleurs — celui-ci est
assez petit pour être lu en un après-midi et audité par vous-même.

## Related work

See [RELATED.md](RELATED.md): Visa TAP, x402 and ATH, with licences and repository figures checked directly.

## État

Version 0.1, publiée pour relecture. Le schéma **va** changer selon les retours.
Ne mettez pas d'argent réel derrière. Aucun déploiement en production, aucun
adoptant, aucun audit : si vous lisez le contraire quelque part, c'est faux.

La relecture du modèle de menace est la contribution la plus utile aujourd'hui.
Ouvrez une issue.

## Licence

Apache-2.0.
