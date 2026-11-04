import { getDb, initSchema, seedDefaultCompany, insertJournalEntry, DEMO_COMPANY_ID } from './db.js';
import { AccountingEngine } from './accounting-engine.js';

export const SEED_MESSAGES = [
  'Vendu pagnes pour 45000 cash',
  'Acheté riz et huile au marché 80000',
  'Reçu paiement client Mohamed 30000 virement',
  'Paye fournisseur Adama 50000',
  'Encaisse prestations couture 25000',
  'Loyer boutique 75000 payed',
  'Salaire employé Ibrahima 100000',
  'Acheté fournitures papier et stylos 8000',
  'Vendu marchandises 35000 cash',
  'Carburant moto ce matin 10000',
  'Facture électricité Senelec 25000',
  'Recharge téléphone 5000',
  'Vendu pagnes et wax 55000 cash',
  'Acheté stock assortiment 120000 crédit fournisseur',
  'Encaisse ventes after work 40000',
  'Paye électricien réparation 15000',
  'Vendu pièces vestimentaires 28000 cash',
  'Acheté stock petit prix 65000',
  'Encaisse commande client Fatou 60000 virement',
  'Frais transport marchandises 12000'
];

/**
 * Exécute le peuplement des 20 écritures de démonstration
 * Relançable sans doublons
 * @param {Database.Database} [customDb]
 */
export function runSeed(customDb) {
  const db = customDb || getDb();
  initSchema(db);
  seedDefaultCompany(db);

  console.log('--- Nettoyage des anciennes écritures de démonstration ---');
  const cleanTx = db.transaction(() => {
    db.prepare(`
      DELETE FROM journal_lines 
      WHERE entry_id IN (SELECT id FROM journal_entries WHERE company_id = ?)
    `).run(DEMO_COMPANY_ID);

    db.prepare('DELETE FROM journal_entries WHERE company_id = ?').run(DEMO_COMPANY_ID);
    db.prepare('DELETE FROM conversations WHERE company_id = ?').run(DEMO_COMPANY_ID);
  });
  cleanTx();

  console.log('--- Traitement des 20 messages de démonstration ---');
  const engine = new AccountingEngine();
  let successCount = 0;
  const unrecognized = [];

  const baseDate = new Date();

  for (let i = 0; i < SEED_MESSAGES.length; i++) {
    const msg = SEED_MESSAGES[i];
    const ruleResult = engine.processRules(msg);

    if (!ruleResult || !ruleResult.matched) {
      unrecognized.push({ index: i + 1, message: msg });
      console.warn(`[NON RECONNU] #${i + 1} : "${msg}"`);
      continue;
    }

    // Échelonner légèrement les dates sur les derniers jours
    const entryDate = new Date(baseDate.getTime() - (SEED_MESSAGES.length - i) * 3600 * 1000 * 24)
      .toISOString()
      .split('T')[0];

    const entryId = `entry-seed-${String(i + 1).padStart(3, '0')}`;

    const lines = [
      {
        account_code: ruleResult.compte_debit,
        debit_amount: ruleResult.montant,
        credit_amount: 0,
        label: ruleResult.libelle
      },
      {
        account_code: ruleResult.compte_credit,
        debit_amount: 0,
        credit_amount: ruleResult.montant,
        label: ruleResult.libelle
      }
    ];

    insertJournalEntry(db, {
      id: entryId,
      company_id: DEMO_COMPANY_ID,
      entry_date: entryDate,
      description: ruleResult.libelle,
      type: ruleResult.type,
      montant: ruleResult.montant,
      source: ruleResult.source,
      confidence: ruleResult.confiance,
      status: 'posted',
      lines,
      message_raw: msg
    });

    successCount++;
    console.log(`[OK] #${i + 1} (${ruleResult.type}) ${ruleResult.montant} FCFA | Débit: ${ruleResult.compte_debit} -> Crédit: ${ruleResult.compte_credit} | "${msg}"`);
  }

  // Vérification de la balance générale
  const balanceRow = db.prepare(`
    SELECT 
      COALESCE(SUM(debit_amount), 0) AS total_debit,
      COALESCE(SUM(credit_amount), 0) AS total_credit
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id
    WHERE je.company_id = ?
  `).get(DEMO_COMPANY_ID);

  const totalDebit = Number(balanceRow.total_debit);
  const totalCredit = Number(balanceRow.total_credit);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.001;

  console.log('\n================ RÉSULTAT DU SEED ================');
  console.log(`Écritures créées avec succès : ${successCount}/${SEED_MESSAGES.length}`);
  console.log(`Messages non reconnus         : ${unrecognized.length}`);
  console.log(`Total Débit                   : ${totalDebit.toLocaleString('fr-FR')} FCFA`);
  console.log(`Total Crédit                  : ${totalCredit.toLocaleString('fr-FR')} FCFA`);
  console.log(`Balance équilibrée            : ${isBalanced ? 'OUI (VALIDÉE)' : 'NON (ERREUR)'}`);
  console.log('===================================================\n');

  if (!customDb) {
    db.close();
  }

  return {
    successCount,
    unrecognizedCount: unrecognized.length,
    unrecognized,
    totalDebit,
    totalCredit,
    isBalanced
  };
}

// Exécution directe via CLI
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('seed-data.js')) {
  try {
    const result = runSeed();
    if (result.successCount !== 20 || result.unrecognizedCount !== 0 || !result.isBalanced || result.totalDebit !== 883000) {
      console.error('Échec des critères d\'acceptation du seed !');
      process.exit(1);
    }
  } catch (err) {
    console.error('Erreur lors du seed :', err);
    process.exit(1);
  }
}
