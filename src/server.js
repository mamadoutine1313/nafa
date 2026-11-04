import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { 
  getDb, 
  initSchema, 
  seedDefaultCompany, 
  insertJournalEntry, 
  getCompanyDetails, 
  updateCompanyDetails, 
  DEMO_COMPANY_ID 
} from './db.js';
import { AccountingEngine } from './accounting-engine.js';
import { processWithAiFallback } from './ai-fallback.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Crée l'application Express avec injection possible d'une base de test
 * @param {import('better-sqlite3').Database} [customDb]
 * @returns {express.Express}
 */
export function createApp(customDb) {
  const app = express();
  const db = customDb || getDb();
  const engine = new AccountingEngine();

  // S'assurer que le schéma et l'entreprise démo existent
  initSchema(db);
  seedDefaultCompany(db);

  // Parsing JSON pour les requêtes POST
  app.use(express.json());

  // Rate-limiter en mémoire (sans dépendance externe)
  // 30 requêtes max par minute par IP sur POST /api/messages
  const rateLimitMap = new Map();
  function rateLimiter(req, res, next) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute
    const maxRequests = 30;

    if (!rateLimitMap.has(ip)) {
      rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }

    const entry = rateLimitMap.get(ip);
    if (now > entry.resetAt) {
      entry.count = 1;
      entry.resetAt = now + windowMs;
      return next();
    }

    if (entry.count >= maxRequests) {
      return res.status(429).json({
        error: 'Trop de requêtes. Limite : 30 par minute. Réessayez dans quelques instants.'
      });
    }

    entry.count++;
    next();
  }

  // Nettoyage toutes les 5 minutes des entrées expirées
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap.entries()) {
      if (now > entry.resetAt) {
        rateLimitMap.delete(ip);
      }
    }
  }, 5 * 60 * 1000).unref();

  // SÉCURITÉ : Ne servir QUE public/index.html sur la racine '/'
  // Jamais express.static('.') pour éviter d'exposer .env ou xidmatech.db
  app.get('/', (req, res) => {
    const indexPath = path.resolve(__dirname, '../public/index.html');
    res.sendFile(indexPath, { dotfiles: 'allow' });
  });

  // GET /api/health
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      version: '1.0.0',
      timestamp: new Date().toISOString()
    });
  });

  // GET /api/company - Informations de l'entreprise et gérant
  app.get('/api/company', (req, res) => {
    try {
      const company = getCompanyDetails(db, DEMO_COMPANY_ID);
      if (!company) {
        return res.status(404).json({ error: 'Entreprise introuvable' });
      }
      res.json(company);
    } catch (err) {
      res.status(500).json({ error: `Erreur interne : ${err.message}` });
    }
  });

  // PUT / POST /api/company - Mise à jour des informations et du régime TVA
  const handleUpdateCompany = (req, res) => {
    try {
      const data = req.body || {};
      if (!data.name || !String(data.name).trim()) {
        return res.status(400).json({ error: "Le nom de l'entreprise est obligatoire" });
      }
      const updated = updateCompanyDetails(db, DEMO_COMPANY_ID, data);
      res.json({
        success: true,
        message: 'Informations de l\'entreprise enregistrées avec succès',
        company: updated
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };

  app.put('/api/company', handleUpdateCompany);
  app.post('/api/company', handleUpdateCompany);

  // GET /api/dashboard/stats - Statistiques complètes pour le tableau de bord
  app.get('/api/dashboard/stats', (req, res) => {
    try {
      const company = getCompanyDetails(db, DEMO_COMPANY_ID);

      // Soldes de Trésorerie
      const cashRow = db.prepare(`
        SELECT COALESCE(SUM(jl.debit_amount - jl.credit_amount), 0) AS balance
        FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.company_id = ? AND jl.account_code = '571'
      `).get(DEMO_COMPANY_ID);

      const bankRow = db.prepare(`
        SELECT COALESCE(SUM(jl.debit_amount - jl.credit_amount), 0) AS balance
        FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.company_id = ? AND jl.account_code = '521'
      `).get(DEMO_COMPANY_ID);

      // Produits (classe 7) et Charges (classe 6)
      const revenuesRow = db.prepare(`
        SELECT COALESCE(SUM(jl.credit_amount - jl.debit_amount), 0) AS total
        FROM journal_lines jl
        JOIN accounts a ON a.code = jl.account_code AND a.company_id = ?
        JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.company_id = ? AND a.class = 7
      `).get(DEMO_COMPANY_ID, DEMO_COMPANY_ID);

      const expensesRow = db.prepare(`
        SELECT COALESCE(SUM(jl.debit_amount - jl.credit_amount), 0) AS total
        FROM journal_lines jl
        JOIN accounts a ON a.code = jl.account_code AND a.company_id = ?
        JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.company_id = ? AND a.class = 6
      `).get(DEMO_COMPANY_ID, DEMO_COMPANY_ID);

      // Immobilisations (classe 2)
      const assetsRow = db.prepare(`
        SELECT COALESCE(SUM(jl.debit_amount - jl.credit_amount), 0) AS total
        FROM journal_lines jl
        JOIN accounts a ON a.code = jl.account_code AND a.company_id = ?
        JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.company_id = ? AND a.class = 2
      `).get(DEMO_COMPANY_ID, DEMO_COMPANY_ID);

      // Créances clients (411) et Dettes fournisseurs (401)
      const clientsRow = db.prepare(`
        SELECT COALESCE(SUM(jl.debit_amount - jl.credit_amount), 0) AS balance
        FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.company_id = ? AND jl.account_code = '411'
      `).get(DEMO_COMPANY_ID);

      const suppliersRow = db.prepare(`
        SELECT COALESCE(SUM(jl.credit_amount - jl.debit_amount), 0) AS balance
        FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.company_id = ? AND jl.account_code = '401'
      `).get(DEMO_COMPANY_ID);

      // Nombre total d'écritures
      const entriesCount = db.prepare(`
        SELECT COUNT(*) AS count FROM journal_entries WHERE company_id = ?
      `).get(DEMO_COMPANY_ID).count;

      const revenues = Number(revenuesRow.total) || 0;
      const expenses = Number(expensesRow.total) || 0;
      const netProfit = revenues - expenses;

      res.json({
        company,
        caisse: Number(cashRow.balance) || 0,
        banque: Number(bankRow.balance) || 0,
        revenus: revenues,
        charges: expenses,
        resultat: netProfit,
        immobilisations: Number(assetsRow.total) || 0,
        creances_clients: Math.max(Number(clientsRow.balance) || 0, 0),
        dettes_fournisseurs: Math.max(Number(suppliersRow.balance) || 0, 0),
        total_entries: entriesCount,
        currency: company?.currency || 'FCFA'
      });
    } catch (err) {
      res.status(500).json({ error: `Erreur stats dashboard : ${err.message}` });
    }
  });

  // GET /api/reports/vat - Rapport sur le régime TVA et calculs fiscaux
  app.get('/api/reports/vat', (req, res) => {
    try {
      const company = getCompanyDetails(db, DEMO_COMPANY_ID);
      const isAssujetti = company?.regime_tva === 'assujetti';
      const tvaRate = company?.tva_rate !== undefined ? company.tva_rate : 18;

      const salesRow = db.prepare(`
        SELECT COALESCE(SUM(jl.credit_amount - jl.debit_amount), 0) AS total_sales
        FROM journal_lines jl
        JOIN accounts a ON a.code = jl.account_code AND a.company_id = ?
        JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.company_id = ? AND a.class = 7
      `).get(DEMO_COMPANY_ID, DEMO_COMPANY_ID);

      const purchasesRow = db.prepare(`
        SELECT COALESCE(SUM(jl.debit_amount - jl.credit_amount), 0) AS total_purchases
        FROM journal_lines jl
        JOIN accounts a ON a.code = jl.account_code AND a.company_id = ?
        JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.company_id = ? AND a.class = 6 AND a.code NOT IN ('641', '646', '671')
      `).get(DEMO_COMPANY_ID, DEMO_COMPANY_ID);

      const totalSales = Math.max(Number(salesRow.total_sales) || 0, 0);
      const totalPurchases = Math.max(Number(purchasesRow.total_purchases) || 0, 0);

      let vatCollected = 0;
      let vatDeductible = 0;
      let netVat = 0;

      if (isAssujetti) {
        vatCollected = Math.round(totalSales * (tvaRate / 100));
        vatDeductible = Math.round(totalPurchases * (tvaRate / 100));
        netVat = vatCollected - vatDeductible;
      }

      res.json({
        company_name: company?.name || 'Entreprise',
        regime_tva: company?.regime_tva || 'non-assujetti',
        is_assujetti: isAssujetti,
        tva_rate: tvaRate,
        currency: company?.currency || 'FCFA',
        sales_basis: totalSales,
        vat_collected: vatCollected,
        purchases_basis: totalPurchases,
        vat_deductible: vatDeductible,
        net_vat: netVat,
        status: !isAssujetti 
          ? 'Franchise en base (Non-assujetti à la TVA)'
          : (netVat >= 0 ? 'TVA nette à reverser au Trésor public' : 'Crédit de TVA reportable')
      });
    } catch (err) {
      res.status(500).json({ error: `Erreur TVA : ${err.message}` });
    }
  });

  // POST /api/messages
  // Body: { message }
  app.post('/api/messages', rateLimiter, async (req, res) => {
    const { message } = req.body || {};

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({
        error: 'Message requis'
      });
    }

    const trimmedMessage = message.trim();

    // 1. Essai avec le moteur de règles déterministes
    let result = engine.processRules(trimmedMessage);

    // 2. Si non reconnu, repli sur l'IA (Claude)
    if (!result || !result.matched) {
      try {
        const aiResult = await processWithAiFallback(trimmedMessage);
        if (aiResult && aiResult.matched) {
          result = aiResult;
        }
      } catch (err) {
        console.error('Erreur fallback IA :', err);
      }
    }

    // 3. Si toujours non reconnu => 422 avec suggestion
    if (!result || !result.matched) {
      // Enregistrer dans la table conversations pour audit trail
      try {
        db.prepare(`
          INSERT INTO conversations (company_id, message_raw, response_json)
          VALUES (?, ?, ?)
        `).run(
          DEMO_COMPANY_ID,
          trimmedMessage,
          JSON.stringify({ error: 'Message non reconnu' })
        );
      } catch (e) {
        console.error('Erreur audit conversation :', e);
      }

      return res.status(422).json({
        error: 'Message non reconnu',
        suggestion: 'Exemple : Vendu pagnes 45000 cash'
      });
    }

    // 4. Enregistrement en partie double dans une transaction
    const entryId = `entry-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const today = new Date().toISOString().split('T')[0];

    const lines = [
      {
        account_code: result.compte_debit,
        debit_amount: result.montant,
        credit_amount: 0,
        label: result.libelle
      },
      {
        account_code: result.compte_credit,
        debit_amount: 0,
        credit_amount: result.montant,
        label: result.libelle
      }
    ];

    try {
      insertJournalEntry(db, {
        id: entryId,
        company_id: DEMO_COMPANY_ID,
        entry_date: today,
        description: result.libelle,
        type: result.type,
        montant: result.montant,
        source: result.source,
        confidence: result.confiance,
        status: 'posted',
        lines,
        message_raw: trimmedMessage
      });

      return res.json({
        success: true,
        entry_id: entryId,
        type: result.type,
        montant: result.montant,
        compte_debit: result.compte_debit,
        compte_credit: result.compte_credit,
        confiance: result.confiance,
        libelle: result.libelle,
        source: result.source
      });
    } catch (err) {
      console.error('Erreur insertion écriture :', err);
      return res.status(500).json({
        error: `Erreur interne lors de l'enregistrement : ${err.message}`
      });
    }
  });

  // GET /api/entries?limit=&offset=
  app.get('/api/entries', (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const totalCount = db.prepare(`
      SELECT COUNT(*) as count 
      FROM journal_entries 
      WHERE company_id = ?
    `).get(DEMO_COMPANY_ID).count;

    const entries = db.prepare(`
      SELECT 
        je.id,
        je.entry_date,
        je.description,
        je.type,
        je.montant,
        je.source,
        je.confidence,
        je.status,
        je.created_at
      FROM journal_entries je
      WHERE je.company_id = ?
      ORDER BY je.rowid DESC
      LIMIT ? OFFSET ?
    `).all(DEMO_COMPANY_ID, limit, offset);

    // Récupérer les lignes pour chaque écriture
    const getLinesStmt = db.prepare(`
      SELECT 
        jl.account_code,
        a.label AS account_label,
        jl.debit_amount,
        jl.credit_amount,
        jl.label
      FROM journal_lines jl
      LEFT JOIN accounts a ON a.code = jl.account_code AND a.company_id = ?
      WHERE jl.entry_id = ?
      ORDER BY jl.debit_amount DESC
    `);

    const enrichedEntries = entries.map(entry => {
      const lines = getLinesStmt.all(DEMO_COMPANY_ID, entry.id);
      const debitLine = lines.find(l => l.debit_amount > 0);
      const creditLine = lines.find(l => l.credit_amount > 0);
      return {
        ...entry,
        compte_debit: debitLine?.account_code || '',
        compte_debit_label: debitLine?.account_label || '',
        compte_credit: creditLine?.account_code || '',
        compte_credit_label: creditLine?.account_label || '',
        lines
      };
    });

    const totals = db.prepare(`
      SELECT 
        COALESCE(SUM(jl.debit_amount), 0) AS total_debit,
        COALESCE(SUM(jl.credit_amount), 0) AS total_credit
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      WHERE je.company_id = ?
    `).get(DEMO_COMPANY_ID);

    res.json({
      entries: enrichedEntries,
      total_count: totalCount,
      limit,
      offset,
      totals: {
        total_debit: Number(totals.total_debit),
        total_credit: Number(totals.total_credit)
      }
    });
  });

  // GET /api/balance?account=571
  app.get('/api/balance', (req, res) => {
    const accountCode = req.query.account;
    if (!accountCode) {
      return res.status(400).json({ error: 'Paramètre account requis' });
    }

    const account = db.prepare(`
      SELECT code, label, class, type 
      FROM accounts 
      WHERE company_id = ? AND code = ?
    `).get(DEMO_COMPANY_ID, String(accountCode));

    if (!account) {
      return res.status(404).json({ error: `Compte ${accountCode} non trouvé` });
    }

    // Règle d'or : SUM directe par code de compte
    const totals = db.prepare(`
      SELECT 
        COALESCE(SUM(jl.debit_amount), 0) AS total_debit,
        COALESCE(SUM(jl.credit_amount), 0) AS total_credit
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      WHERE je.company_id = ? AND jl.account_code = ?
    `).get(DEMO_COMPANY_ID, String(accountCode));

    const totalDebit = Number(totals.total_debit);
    const totalCredit = Number(totals.total_credit);

    // Calcul du solde selon la nature du compte
    let balance = 0;
    if (account.type === 'actif' || account.type === 'charge') {
      balance = totalDebit - totalCredit;
    } else {
      balance = totalCredit - totalDebit;
    }

    res.json({
      account_code: account.code,
      account_label: account.label,
      class: account.class,
      type: account.type,
      total_debit: totalDebit,
      total_credit: totalCredit,
      balance
    });
  });

  // GET /api/reports/trial-balance
  // Règle d'or : SUM directe par code de compte. Ne jamais comparer un code de compte à l'identifiant de l'entreprise.
  app.get('/api/reports/trial-balance', (req, res) => {
    const rows = db.prepare(`
      SELECT 
        a.code AS account_code,
        a.label AS account_label,
        a.class AS class,
        a.type AS type,
        COALESCE(SUM(jl.debit_amount), 0) AS total_debit,
        COALESCE(SUM(jl.credit_amount), 0) AS total_credit
      FROM accounts a
      LEFT JOIN journal_lines jl ON jl.account_code = a.code 
        AND jl.entry_id IN (SELECT id FROM journal_entries WHERE company_id = ?)
      WHERE a.company_id = ?
      GROUP BY a.code, a.label, a.class, a.type
      ORDER BY a.code ASC
    `).all(DEMO_COMPANY_ID, DEMO_COMPANY_ID);

    let sumDebit = 0;
    let sumCredit = 0;
    let sumDebitBalance = 0;
    let sumCreditBalance = 0;

    const accounts = rows.map(r => {
      const debit = Number(r.total_debit);
      const credit = Number(r.total_credit);
      sumDebit += debit;
      sumCredit += credit;

      let debitBalance = 0;
      let creditBalance = 0;
      if (debit >= credit) {
        debitBalance = debit - credit;
        sumDebitBalance += debitBalance;
      } else {
        creditBalance = credit - debit;
        sumCreditBalance += creditBalance;
      }

      return {
        account_code: r.account_code,
        account_label: r.account_label,
        class: r.class,
        type: r.type,
        total_debit: debit,
        total_credit: credit,
        debit_balance: debitBalance,
        credit_balance: creditBalance
      };
    });

    const isBalanced = Math.abs(sumDebit - sumCredit) < 0.001;

    res.json({
      accounts,
      totals: {
        total_debit: sumDebit,
        total_credit: sumCredit,
        total_debit_balance: sumDebitBalance,
        total_credit_balance: sumCreditBalance
      },
      balanced: isBalanced
    });
  });

  // GET /api/reports/income-statement
  // Compte de résultat : Produits = classe 7 (credit - debit), Charges = classe 6 (debit - credit)
  app.get('/api/reports/income-statement', (req, res) => {
    const rows = db.prepare(`
      SELECT 
        a.code AS account_code,
        a.label AS account_label,
        a.class AS class,
        a.type AS type,
        COALESCE(SUM(jl.debit_amount), 0) AS total_debit,
        COALESCE(SUM(jl.credit_amount), 0) AS total_credit
      FROM accounts a
      LEFT JOIN journal_lines jl ON jl.account_code = a.code 
        AND jl.entry_id IN (SELECT id FROM journal_entries WHERE company_id = ?)
      WHERE a.company_id = ? AND a.class IN (6, 7)
      GROUP BY a.code, a.label, a.class, a.type
      ORDER BY a.code ASC
    `).all(DEMO_COMPANY_ID, DEMO_COMPANY_ID);

    const revenuesAccounts = [];
    let totalRevenues = 0;

    const expensesAccounts = [];
    let totalExpenses = 0;

    for (const r of rows) {
      const debit = Number(r.total_debit);
      const credit = Number(r.total_credit);

      if (r.class === 7) {
        // Produits : solde créditeur net
        const amount = credit - debit;
        revenuesAccounts.push({
          account_code: r.account_code,
          account_label: r.account_label,
          total_debit: debit,
          total_credit: credit,
          amount
        });
        totalRevenues += amount;
      } else if (r.class === 6) {
        // Charges : solde débiteur net
        const amount = debit - credit;
        expensesAccounts.push({
          account_code: r.account_code,
          account_label: r.account_label,
          total_debit: debit,
          total_credit: credit,
          amount
        });
        totalExpenses += amount;
      }
    }

    const netProfit = totalRevenues - totalExpenses;

    res.json({
      revenues: {
        accounts: revenuesAccounts,
        total: totalRevenues
      },
      expenses: {
        accounts: expensesAccounts,
        total: totalExpenses
      },
      net_profit: netProfit,
      currency: 'FCFA'
    });
  });

  // GET /api/reports/balance-sheet
  // Bilan Actif/Passif selon SYSCOHADA : classes 1-5
  // Actif = classes 2, 3, 4 (comptes de type actif), 5
  // Passif = classes 1, 4 (comptes de type passif)
  app.get('/api/reports/balance-sheet', (req, res) => {
    const rows = db.prepare(`
      SELECT 
        a.code AS account_code,
        a.label AS account_label,
        a.class AS class,
        a.type AS type,
        COALESCE(SUM(jl.debit_amount), 0) AS total_debit,
        COALESCE(SUM(jl.credit_amount), 0) AS total_credit
      FROM accounts a
      LEFT JOIN journal_lines jl ON jl.account_code = a.code 
        AND jl.entry_id IN (SELECT id FROM journal_entries WHERE company_id = ?)
      WHERE a.company_id = ? AND a.class IN (1, 2, 3, 4, 5)
      GROUP BY a.code, a.label, a.class, a.type
      ORDER BY a.code ASC
    `).all(DEMO_COMPANY_ID, DEMO_COMPANY_ID);

    const assets = [];      // ACTIF : type actif
    const liabilities = []; // PASSIF : type passif
    let totalAssets = 0;
    let totalLiabilities = 0;

    for (const r of rows) {
      const debit = Number(r.total_debit);
      const credit = Number(r.total_credit);

      if (r.type === 'actif') {
        // Actif : solde débiteur (debit - credit)
        const balance = debit - credit;
        assets.push({
          account_code: r.account_code,
          account_label: r.account_label,
          class: r.class,
          total_debit: debit,
          total_credit: credit,
          balance
        });
        totalAssets += balance;
      } else if (r.type === 'passif') {
        // Passif : solde créditeur (credit - debit)
        const balance = credit - debit;
        liabilities.push({
          account_code: r.account_code,
          account_label: r.account_label,
          class: r.class,
          total_debit: debit,
          total_credit: credit,
          balance
        });
        totalLiabilities += balance;
      }
    }

    res.json({
      assets: {
        accounts: assets,
        total: totalAssets
      },
      liabilities: {
        accounts: liabilities,
        total: totalLiabilities
      },
      net_position: totalAssets - totalLiabilities,
      currency: 'FCFA'
    });
  });

  return app;
}

// Démarrage du serveur si exécuté directement
const isDirectExecution = process.argv[1] && (
  import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` ||
  process.argv[1].endsWith('server.js')
);

if (isDirectExecution) {
  const PORT = process.env.PORT || 5000;
  const app = createApp();

  app.listen(PORT, () => {
    console.log(`NAFA SaaS - Serveur de Comptabilité SYSCOHADA démarré sur http://localhost:${PORT}`);
  });
}
