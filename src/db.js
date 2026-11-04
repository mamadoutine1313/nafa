import Database from 'better-sqlite3';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export const DEMO_COMPANY_ID = 'demo-senegal';

export const SYSCOHADA_ACCOUNTS = [
  // Classe 1 - Ressources durables (Passif)
  { code: '101', label: 'Capital social', type: 'passif' },
  { code: '104', label: 'Compte de l\'exploitant', type: 'passif' },
  { code: '162', label: 'Emprunts et dettes financières', type: 'passif' },

  // Classe 2 - Actif immobilisé (Actif)
  { code: '241', label: 'Matériel et outillage industriel et commercial', type: 'actif' },
  { code: '244', label: 'Matériel et mobilier de bureau et informatique', type: 'actif' },
  { code: '245', label: 'Matériel de transport', type: 'actif' },

  // Classe 4 - Tiers & TVA (Actif / Passif)
  { code: '401', label: 'Fournisseurs', type: 'passif' },
  { code: '411', label: 'Clients', type: 'actif' },
  { code: '422', label: 'Personnel - Avances et acomptes', type: 'actif' },
  { code: '4451', label: 'État, TVA à décaisser', type: 'passif' },
  { code: '4452', label: 'État, TVA facturée sur ventes', type: 'passif' },
  { code: '4453', label: 'État, TVA récupérable sur achats et charges', type: 'actif' },
  { code: '4454', label: 'État, crédit de TVA à reporter', type: 'actif' },

  // Classe 5 - Trésorerie (Actif)
  { code: '521', label: 'Banque', type: 'actif' },
  { code: '571', label: 'Caisse', type: 'actif' },
  { code: '585', label: 'Virements de fonds internes', type: 'actif' },

  // Classe 6 - Charges d'exploitation et financières (Charge)
  { code: '601', label: 'Achats de marchandises', type: 'charge' },
  { code: '604', label: 'Fournitures', type: 'charge' },
  { code: '6051', label: 'Carburant', type: 'charge' },
  { code: '6053', label: 'Électricité et eau', type: 'charge' },
  { code: '613', label: 'Loyers', type: 'charge' },
  { code: '615', label: 'Entretien et réparations', type: 'charge' },
  { code: '622', label: 'Rémunérations d\'intermédiaires et honoraires', type: 'charge' },
  { code: '624', label: 'Transports', type: 'charge' },
  { code: '625', label: 'Primes d\'assurances', type: 'charge' },
  { code: '626', label: 'Télécommunications', type: 'charge' },
  { code: '627', label: 'Publicité, publications et relations publiques', type: 'charge' },
  { code: '628', label: 'Gardiennage, sécurité et entretien locaux', type: 'charge' },
  { code: '631', label: 'Frais bancaires et commissions Wave/OM', type: 'charge' },
  { code: '641', label: 'Salaires', type: 'charge' },
  { code: '646', label: 'Impôts et taxes directs, patentes', type: 'charge' },
  { code: '671', label: 'Intérêts des emprunts', type: 'charge' },

  // Classe 7 - Produits d'exploitation et financiers (Produit)
  { code: '701', label: 'Ventes de marchandises', type: 'produit' },
  { code: '706', label: 'Prestations de services', type: 'produit' },
  { code: '754', label: 'Revenus des locations et sous-locations', type: 'produit' },
  { code: '771', label: 'Intérêts et produits financiers', type: 'produit' }
];

/**
 * Initialise une connexion SQLite via better-sqlite3
 * @param {string} [customPath]
 * @returns {Database.Database}
 */
export function getDb(customPath) {
  const dbPath = customPath || process.env.DATABASE_PATH || './xidmatech.db';
  const resolvedPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(process.cwd(), dbPath);
  const db = new Database(resolvedPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  return db;
}

/**
 * Crée les tables séquentiellement et de façon idempotente
 * @param {Database.Database} db
 */
export function initSchema(db) {
  // Exécution séquentielle des CREATE TABLE
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      country TEXT NOT NULL,
      regime_tva TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      whatsapp_number TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      FOREIGN KEY (company_id) REFERENCES companies(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id TEXT NOT NULL,
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      class INTEGER NOT NULL,
      type TEXT NOT NULL,
      UNIQUE(company_id, code),
      FOREIGN KEY (company_id) REFERENCES companies(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      entry_date TEXT NOT NULL,
      description TEXT NOT NULL,
      type TEXT NOT NULL,
      montant REAL NOT NULL,
      source TEXT NOT NULL,
      confidence REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'posted',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (company_id) REFERENCES companies(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS journal_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id TEXT NOT NULL,
      account_code TEXT NOT NULL,
      debit_amount REAL NOT NULL DEFAULT 0,
      credit_amount REAL NOT NULL DEFAULT 0,
      label TEXT,
      CHECK(debit_amount >= 0 AND credit_amount >= 0),
      FOREIGN KEY (entry_id) REFERENCES journal_entries(id)
    );
  `);

  // Index de performance sur journal_lines
  db.exec(`CREATE INDEX IF NOT EXISTS idx_jl_account ON journal_lines(account_code);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_jl_entry ON journal_lines(entry_id);`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id TEXT NOT NULL,
      message_raw TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (company_id) REFERENCES companies(id)
    );
  `);

  // Migrations idempotentes de colonnes étendues pour la table companies
  try { db.exec(`ALTER TABLE companies ADD COLUMN currency TEXT DEFAULT 'FCFA';`); } catch (e) {}
  try { db.exec(`ALTER TABLE companies ADD COLUMN ninea TEXT DEFAULT '';`); } catch (e) {}
  try { db.exec(`ALTER TABLE companies ADD COLUMN tva_rate REAL DEFAULT 18;`); } catch (e) {}
  try { db.exec(`ALTER TABLE companies ADD COLUMN phone TEXT DEFAULT '';`); } catch (e) {}
  try { db.exec(`ALTER TABLE companies ADD COLUMN address TEXT DEFAULT '';`); } catch (e) {}
  try { db.exec(`ALTER TABLE companies ADD COLUMN legal_form TEXT DEFAULT 'SARL';`); } catch (e) {}
  try { db.exec(`ALTER TABLE companies ADD COLUMN activity TEXT DEFAULT '';`); } catch (e) {}
}

/**
 * Récupère les informations complètes de l'entreprise
 * @param {Database.Database} db 
 * @param {string} [companyId]
 * @returns {Object|null}
 */
export function getCompanyDetails(db, companyId = DEMO_COMPANY_ID) {
  const company = db.prepare(`SELECT * FROM companies WHERE id = ?`).get(companyId);
  if (!company) return null;
  const user = db.prepare(`SELECT * FROM users WHERE company_id = ? ORDER BY id ASC LIMIT 1`).get(companyId);

  return {
    id: company.id,
    name: company.name,
    country: company.country,
    regime_tva: company.regime_tva || 'non-assujetti',
    tva_rate: company.tva_rate !== undefined && company.tva_rate !== null ? Number(company.tva_rate) : 18,
    currency: company.currency || 'FCFA',
    ninea: company.ninea || '',
    phone: company.phone || user?.whatsapp_number || '',
    address: company.address || '',
    legal_form: company.legal_form || 'SARL',
    activity: company.activity || '',
    created_at: company.created_at,
    owner_name: user?.name || '',
    owner_whatsapp: user?.whatsapp_number || ''
  };
}

/**
 * Met à jour les informations de l'entreprise et de son gérant
 * @param {Database.Database} db 
 * @param {string} [companyId]
 * @param {Object} data 
 * @returns {Object}
 */
export function updateCompanyDetails(db, companyId = DEMO_COMPANY_ID, data = {}) {
  const {
    name,
    country,
    regime_tva,
    tva_rate,
    currency = 'FCFA',
    ninea = '',
    phone = '',
    address = '',
    legal_form = 'SARL',
    activity = '',
    owner_name = '',
    owner_whatsapp = ''
  } = data;

  if (!name || !name.trim()) {
    throw new Error("Le nom de l'entreprise est obligatoire.");
  }

  const validRegimes = ['assujetti', 'non-assujetti'];
  const safeRegime = validRegimes.includes(regime_tva) ? regime_tva : 'non-assujetti';
  const safeRate = Number.isFinite(Number(tva_rate)) && Number(tva_rate) >= 0 ? Number(tva_rate) : 18;

  const updateTx = db.transaction(() => {
    // Mettre à jour l'entreprise
    db.prepare(`
      UPDATE companies 
      SET 
        name = ?,
        country = ?,
        regime_tva = ?,
        tva_rate = ?,
        currency = ?,
        ninea = ?,
        phone = ?,
        address = ?,
        legal_form = ?,
        activity = ?
      WHERE id = ?
    `).run(
      name.trim(),
      (country || 'Sénégal').trim(),
      safeRegime,
      safeRate,
      currency.trim(),
      ninea.trim(),
      phone.trim(),
      address.trim(),
      legal_form.trim(),
      activity.trim(),
      companyId
    );

    // Mettre à jour l'utilisateur gérant / propriétaire
    if (owner_name || owner_whatsapp) {
      const user = db.prepare(`SELECT id FROM users WHERE company_id = ? LIMIT 1`).get(companyId);
      if (user) {
        db.prepare(`
          UPDATE users 
          SET 
            name = COALESCE(?, name),
            whatsapp_number = COALESCE(?, whatsapp_number)
          WHERE id = ?
        `).run(owner_name?.trim() || null, owner_whatsapp?.trim() || null, user.id);
      } else {
        db.prepare(`
          INSERT INTO users (id, company_id, whatsapp_number, name, role)
          VALUES (?, ?, ?, ?, 'owner')
        `).run(`user-${Date.now()}`, companyId, owner_whatsapp?.trim() || '+22100000000', owner_name?.trim() || 'Dirigeant');
      }
    }
  });

  updateTx();
  return getCompanyDetails(db, companyId);
}

/**
 * Insère les données de base pour l'entreprise démo
 * @param {Database.Database} db
 */
export function seedDefaultCompany(db) {
  const insertCompany = db.prepare(`
    INSERT OR IGNORE INTO companies (id, name, country, regime_tva)
    VALUES (?, ?, ?, ?)
  `);
  insertCompany.run('demo-senegal', 'Boutique Dakar SARL', 'Sénégal', 'non-assujetti');

  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (id, company_id, whatsapp_number, name, role)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertUser.run('user-001', 'demo-senegal', '+221701234567', 'Ibrahima Sow', 'owner');

  const insertAccount = db.prepare(`
    INSERT OR IGNORE INTO accounts (company_id, code, label, class, type)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const acc of SYSCOHADA_ACCOUNTS) {
    const accountClass = parseInt(acc.code.charAt(0), 10);
    insertAccount.run('demo-senegal', acc.code, acc.label, accountClass, acc.type);
  }
}

/**
 * Insère une écriture comptable en partie double de façon atomique dans une transaction
 * Vérifie :
 * - Au moins 2 lignes
 * - Somme débit == Somme crédit
 * - Montants >= 0
 * @param {Database.Database} db
 * @param {Object} data
 */
export function insertJournalEntry(db, data) {
  const {
    id,
    company_id = DEMO_COMPANY_ID,
    entry_date = new Date().toISOString().split('T')[0],
    description,
    type,
    montant,
    source,
    confidence,
    status = 'posted',
    lines = [],
    message_raw = ''
  } = data;

  if (!lines || lines.length < 2) {
    throw new Error('Une écriture comptable doit comporter au moins 2 lignes.');
  }

  let totalDebit = 0;
  let totalCredit = 0;

  for (const line of lines) {
    const debit = Number(line.debit_amount) || 0;
    const credit = Number(line.credit_amount) || 0;
    if (debit < 0 || credit < 0) {
      throw new Error('Les montants de débit et crédit doivent être positifs ou nuls.');
    }
    totalDebit += debit;
    totalCredit += credit;
  }

  // Vérification de l'équilibre en partie double (tolérance de flottant 0.001)
  if (Math.abs(totalDebit - totalCredit) > 0.001) {
    throw new Error(`Écriture déséquilibrée : débit total (${totalDebit}) != crédit total (${totalCredit})`);
  }

  if (Math.abs(totalDebit - Number(montant)) > 0.001) {
    throw new Error(`Le montant de l'écriture (${montant}) ne correspond pas au total des lignes (${totalDebit})`);
  }

  const insertEntryStmt = db.prepare(`
    INSERT INTO journal_entries (id, company_id, entry_date, description, type, montant, source, confidence, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertLineStmt = db.prepare(`
    INSERT INTO journal_lines (entry_id, account_code, debit_amount, credit_amount, label)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertConvStmt = db.prepare(`
    INSERT INTO conversations (company_id, message_raw, response_json)
    VALUES (?, ?, ?)
  `);

  const tx = db.transaction(() => {
    insertEntryStmt.run(
      id,
      company_id,
      entry_date,
      description,
      type,
      montant,
      source,
      confidence,
      status
    );

    for (const line of lines) {
      insertLineStmt.run(
        id,
        line.account_code,
        Number(line.debit_amount) || 0,
        Number(line.credit_amount) || 0,
        line.label || description
      );
    }

    if (message_raw) {
      insertConvStmt.run(
        company_id,
        message_raw,
        JSON.stringify({
          entry_id: id,
          type,
          montant,
          source,
          confidence,
          lines
        })
      );
    }
  });

  tx();
  return { id, totalDebit, totalCredit };
}
