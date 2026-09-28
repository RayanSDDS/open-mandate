// End-to-end: "buy me this", with no per-purchase human tap.
//
// The human authenticates ONCE, when the mandate is created. After that the
// agent transacts inside it, the merchant verifies independently, and both
// sides hold a signature. Above the threshold the human is pulled back in —
// that is the whole point of setting one.

import { keygen, issue, receipt, audit } from './openmandate.js';
import { assertRequest } from './assertion.js';
import { propose, confirm, verifySession } from './handshake.js';
import { createMerchant } from './merchant.js';

const EUR = a => ({ amount: a, currency: 'EUR' });
const line = () => console.log('-'.repeat(70));

export function shop() {
  let failed = 0, total = 0;
  const expect = (label, got, want) => {
    total++; const ok = got === want; if (!ok) failed++;
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(48)} ${got}${ok ? '' : ` (attendu ${want})`}`);
  };

  const human = keygen(), agent = keygen(), shopKeys = keygen();

  line();
  console.log('ETAPE 1  L\'humain signe UNE fois. Plus jamais ensuite.');
  const mandate = issue({
    principalPriv: human.priv, principalPub: human.pub, agentPub: agent.pub,
    agentId: 'urn:agent:claude-desktop', operator: 'Anthropic',
    actions: ['payment.authorize'],
    merchants: ['hardware.example'],
    perTx: EUR('500.00'), total: EUR('1500.00'), maxUses: 20,
    humanAbove: EUR('200.00'), purpose: 'Bathroom renovation',
  });
  console.log('         <= 500 EUR/achat | <= 1500 EUR au total | humain au-dela de 200 EUR');

  const TERMS = { returns_window_days: 30, price_list: 'pl-2026-09',
                  disputes: 'disputes@hardware.example' };
  const leroy = createMerchant({ host: 'hardware.example', priv: shopKeys.priv,
                                 pub: shopKeys.pub, terms: TERMS, requireSession: true });

  line();
  console.log("ETAPE 1b  Poignee de main a trois. Le marchand s'engage AUSSI.");
  const proposal = propose({ mandate, merchantHost: 'hardware.example', agentPriv: agent.priv });
  const accepted = leroy.acceptProposal({ mandate, proposal });
  const confirmed = confirm({ mandate, proposal, acceptance: accepted.acceptance, agentPriv: agent.priv });
  const session = confirmed.session;
  const sv = verifySession({ mandate, session, merchantHost: 'hardware.example' });
  expect('les trois parties ont signe les memes termes', sv.ok, true);
  console.log(`         retours sous ${sv.terms.returns_window_days} j · tarif ${sv.terms.price_list}`);
  const ledger = [];

  // The agent does the whole thing by itself.
  const buy = (label, amount) => {
    const request = { action: 'payment.authorize', merchant: 'hardware.example', amount: EUR(amount) };
    const assertion = assertRequest({ mandate, request, agentPriv: agent.priv });
    const out = leroy.checkout({ mandate, request, assertion, session });
    if (out.decision === 'authorized') {
      ledger.push(receipt({ mandate, ledger, ...request, outcome: 'authorized',
                            evidence: { order_id: out.order_id } }, agent.priv));
    }
    expect(label, out.decision, amount === '350.00' ? 'needs_human' : 'authorized');
    return out;
  };

  line();
  console.log('ETAPE 2  "Achete-moi ca." L\'agent achete seul. Aucune validation demandee.');
  const a = buy('Mixer tap               89.90 EUR', '89.90');
  const b = buy('Floor tiles 6 m2        149.90 EUR', '149.90');
  const c = buy('Silicone sealant          7.40 EUR', '7.40');
  console.log(`         commande ${a.order_id}`);
  console.log(`         commande ${b.order_id}`);
  console.log(`         commande ${c.order_id}`);

  line();
  console.log('ETAPE 3  Au-dessus du seuil, l\'humain revient dans la boucle.');
  buy('Shower enclosure      350.00 EUR', '350.00');

  line();
  console.log('ETAPE 4  Un voleur copie le fichier du mandat.');
  const thief = keygen();
  const req = { action: 'payment.authorize', merchant: 'hardware.example', amount: EUR('10.00') };
  const stolen = leroy.checkout({
    mandate, request: req, session,
    assertion: assertRequest({ mandate, request: req, agentPriv: thief.priv }),
  });
  expect('achat avec le mandat vole', stolen.decision, 'declined');
  console.log(`         motif: ${stolen.reason}`);

  line();
  console.log('ETAPE 5  Le marchand ne peut plus nier les conditions.');
  const forge = JSON.parse(JSON.stringify(session));
  forge.acceptance.terms.returns_window_days = 0;
  expect('conditions reecrites apres coup', verifySession({ mandate, session: forge, merchantHost: 'hardware.example' }).ok, false);

  line();
  console.log('ETAPE 6  Les deux parties tiennent des comptes independants.');
  const st = leroy.statement(mandate.id);
  const au = audit(mandate, ledger);
  console.log(`         livre du marchand : ${st.count} commandes, ${st.spent} EUR`);
  console.log(`         livre de l'agent  : ${au.count} recus,     ${au.spent} EUR`);
  expect('les deux livres concordent', st.spent, au.spent);
  expect('chaine de recus de l\'agent intacte', au.ok, true);

  line();
  console.log(failed === 0
    ? `TOUT PASSE  ${total}/${total}  —  3 achats sans aucune validation humaine`
    : `${failed} ECHEC(S) sur ${total}`);
  return failed;
}

if (process.argv[2] === 'shop') process.exit(shop() === 0 ? 0 : 1);
