import { getDb, initSchema, seedDefaultCompany, SYSCOHADA_ACCOUNTS } from './db.js';

console.log('--- Initialisation de la base de données xidmatech.db ---');

try {
  const db = getDb();

  console.log('1. Création séquentielle du schéma...');
  initSchema(db);
  console.log('   Schéma créé avec succès.');

  console.log('2. Insertion des données par défaut (Entreprise, Utilisateur, Comptes SYSCOHADA)...');
  seedDefaultCompany(db);

  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get('demo-senegal');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get('user-001');
  const accountsCount = db.prepare('SELECT COUNT(*) as count FROM accounts WHERE company_id = ?').get('demo-senegal');

  console.log(`   Entreprise : ${company?.name} (${company?.country}, ${company?.regime_tva})`);
  console.log(`   Utilisateur : ${user?.name} (${user?.whatsapp_number}, ${user?.role})`);
  console.log(`   Comptes SYSCOHADA insérés : ${accountsCount.count}/${SYSCOHADA_ACCOUNTS.length}`);

  db.close();
  console.log('--- Initialisation terminée avec succès ---');
} catch (error) {
  console.error('Erreur lors de l\'initialisation de la base :', error);
  process.exit(1);
}
