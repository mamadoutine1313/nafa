import { getDb, initSchema, seedDefaultCompany, DEMO_COMPANY_ID } from './db.js';

console.log('--- Remise à zéro des opérations comptables ---');

try {
  const db = getDb();
  
  // S'assurer que le schéma et l'entreprise par défaut existent
  initSchema(db);
  seedDefaultCompany(db);

  // Supprimer toutes les écritures et lignes associées
  const resetTx = db.transaction(() => {
    const deletedLines = db.prepare(`
      DELETE FROM journal_lines 
      WHERE entry_id IN (SELECT id FROM journal_entries WHERE company_id = ?)
    `).run(DEMO_COMPANY_ID);

    // Supprimer également les lignes orphelines éventuelles
    db.prepare('DELETE FROM journal_lines WHERE entry_id NOT IN (SELECT id FROM journal_entries)').run();

    const deletedEntries = db.prepare('DELETE FROM journal_entries WHERE company_id = ?').run(DEMO_COMPANY_ID);
    const deletedConvs = db.prepare('DELETE FROM conversations WHERE company_id = ?').run(DEMO_COMPANY_ID);

    console.log(`Lignes de journal supprimées : ${deletedLines.changes}`);
    console.log(`Écritures supprimées         : ${deletedEntries.changes}`);
    console.log(`Conversations supprimées     : ${deletedConvs.changes}`);
  });

  resetTx();

  // Optimiser et compacter la base
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.exec('VACUUM');

  // Vérifications
  const countEntries = db.prepare('SELECT COUNT(*) as c FROM journal_entries').get().c;
  const countLines = db.prepare('SELECT COUNT(*) as c FROM journal_lines').get().c;
  const countConvs = db.prepare('SELECT COUNT(*) as c FROM conversations').get().c;
  const countAccounts = db.prepare('SELECT COUNT(*) as c FROM accounts').get().c;
  const company = db.prepare('SELECT name FROM companies WHERE id = ?').get(DEMO_COMPANY_ID);

  console.log('--------------------------------------------------');
  console.log(`Entreprise active   : ${company?.name}`);
  console.log(`Comptes SYSCOHADA   : ${countAccounts}`);
  console.log(`Écritures restantes : ${countEntries}`);
  console.log(`Lignes restantes    : ${countLines}`);
  console.log(`Audit conversations : ${countConvs}`);
  console.log('Opérations remises à zéro avec succès !');
  console.log('--------------------------------------------------');

  db.close();
} catch (error) {
  console.error('Erreur lors de la remise à zéro :', error);
  process.exit(1);
}
