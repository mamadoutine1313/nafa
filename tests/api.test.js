import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { createApp } from '../src/server.js';
import { getDb, initSchema, seedDefaultCompany } from '../src/db.js';

const TEST_DB_PATH = './test-api.db';
const TEST_PORT = 5099;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

describe('API Endpoints & Sécurité', () => {
  let server;
  let testDb;

  before(async () => {
    // Supprimer une éventuelle base temporaire résiduelle
    if (fs.existsSync(TEST_DB_PATH)) {
      try { fs.unlinkSync(TEST_DB_PATH); } catch (e) {}
    }

    testDb = getDb(TEST_DB_PATH);
    initSchema(testDb);
    seedDefaultCompany(testDb);

    const app = createApp(testDb);

    await new Promise((resolve) => {
      server = app.listen(TEST_PORT, '127.0.0.1', () => {
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (testDb) {
      testDb.close();
    }
    if (fs.existsSync(TEST_DB_PATH)) {
      try { fs.unlinkSync(TEST_DB_PATH); } catch (e) {}
    }
    // Nettoyer aussi les fichiers -wal et -shm s'ils existent
    if (fs.existsSync(`${TEST_DB_PATH}-wal`)) {
      try { fs.unlinkSync(`${TEST_DB_PATH}-wal`); } catch (e) {}
    }
    if (fs.existsSync(`${TEST_DB_PATH}-shm`)) {
      try { fs.unlinkSync(`${TEST_DB_PATH}-shm`); } catch (e) {}
    }
  });

  test('GET / sert index.html avec le code 200', async () => {
    const res = await fetch(`${BASE_URL}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Boutique Dakar/i);
    assert.match(html, /NAFA/i);
  });

  test('SÉCURITÉ : GET /.env doit impérativement renvoyer 404', async () => {
    const res = await fetch(`${BASE_URL}/.env`);
    assert.equal(res.status, 404, 'Le fichier .env ne doit jamais être exposé');
  });

  test('SÉCURITÉ : GET /xidmatech.db doit impérativement renvoyer 404', async () => {
    const res = await fetch(`${BASE_URL}/xidmatech.db`);
    assert.equal(res.status, 404, 'La base SQLite ne doit jamais être exposée');
  });

  test('GET /api/health renvoie status ok', async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.version, '1.0.0');
    assert.ok(body.timestamp);
  });

  test('POST /api/messages message vide renvoie 400', async () => {
    const res = await fetch(`${BASE_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '   ' })
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'Message requis');
  });

  test('POST /api/messages message non reconnu renvoie 422 avec suggestion', async () => {
    const res = await fetch(`${BASE_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'bonjour comment ça va' })
    });
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.error, 'Message non reconnu');
    assert.ok(body.suggestion);
  });

  test('POST /api/messages message valide crée une écriture équilibrée', async () => {
    const res = await fetch(`${BASE_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Vendu pagnes 45000 cash' })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.type, 'vente');
    assert.equal(body.montant, 45000);
    assert.equal(body.compte_debit, '571');
    assert.equal(body.compte_credit, '701');
    assert.equal(body.confiance, 0.97);
    assert.ok(body.entry_id);
  });

  test('POST /api/messages deuxième écriture (charge)', async () => {
    const res = await fetch(`${BASE_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Loyer boutique 75000' })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.type, 'charge');
    assert.equal(body.montant, 75000);
    assert.equal(body.compte_debit, '613');
    assert.equal(body.compte_credit, '571');
  });

  test('GET /api/entries liste les écritures avec totaux', async () => {
    const res = await fetch(`${BASE_URL}/api/entries`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total_count, 2);
    assert.equal(body.entries.length, 2);
    assert.equal(body.totals.total_debit, 120000);
    assert.equal(body.totals.total_credit, 120000);
    assert.equal(body.entries[0].compte_debit_label, 'Loyers');
    assert.equal(body.entries[1].compte_debit_label, 'Caisse');
  });

  test('GET /api/balance?account=571 renvoie le solde de la Caisse', async () => {
    const res = await fetch(`${BASE_URL}/api/balance?account=571`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.account_code, '571');
    assert.equal(body.account_label, 'Caisse');
    assert.equal(body.total_debit, 45000);
    assert.equal(body.total_credit, 75000);
    assert.equal(body.balance, -30000); // 45000 - 75000
  });

  test('GET /api/reports/trial-balance vérifie la balance équilibrée', async () => {
    const res = await fetch(`${BASE_URL}/api/reports/trial-balance`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.balanced, true);
    assert.equal(body.totals.total_debit, 120000);
    assert.equal(body.totals.total_credit, 120000);
    assert.ok(Array.isArray(body.accounts));
    assert.equal(body.accounts.length, 36);

    // Vérifier la présence du libellé réel par JOIN
    const caisse = body.accounts.find(a => a.account_code === '571');
    assert.equal(caisse.account_label, 'Caisse');
  });

  test('GET /api/reports/income-statement calcule produits, charges et résultat net', async () => {
    const res = await fetch(`${BASE_URL}/api/reports/income-statement`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.revenues.total, 45000); // Ventes 701
    assert.equal(body.expenses.total, 75000); // Loyers 613
    assert.equal(body.net_profit, -30000);   // 45000 - 75000
  });

  test('GET /api/balance?account=521 renvoie le solde de la Banque', async () => {
    // La Banque (521) n'a pas eu de mouvement dans cette session test → solde = 0
    const res = await fetch(`${BASE_URL}/api/balance?account=521`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.account_code, '521');
    assert.equal(body.account_label, 'Banque');
    assert.equal(body.type, 'actif');
    assert.equal(body.total_debit, 0);
    assert.equal(body.total_credit, 0);
    assert.equal(body.balance, 0);
  });

  test('GET /api/balance renvoie 400 sans paramètre account', async () => {
    const res = await fetch(`${BASE_URL}/api/balance`);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error);
  });

  test('GET /api/balance?account=999 renvoie 404 pour compte inconnu', async () => {
    const res = await fetch(`${BASE_URL}/api/balance?account=999`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.match(body.error, /non trouvé/);
  });

  test('GET /api/reports/balance-sheet renvoie actif, passif et position nette', async () => {
    const res = await fetch(`${BASE_URL}/api/reports/balance-sheet`);
    assert.equal(res.status, 200);
    const body = await res.json();

    // Structure attendue
    assert.ok(body.assets, 'Doit avoir une clé assets');
    assert.ok(body.liabilities, 'Doit avoir une clé liabilities');
    assert.ok(typeof body.net_position === 'number', 'net_position doit être un nombre');
    assert.equal(body.currency, 'FCFA');

    // Les comptes actifs (571 Caisse, 521 Banque, 411 Clients)
    assert.ok(Array.isArray(body.assets.accounts));
    assert.ok(Array.isArray(body.liabilities.accounts));

    // Caisse = 45000 débit - 75000 crédit = -30000 → actif avec solde -30000
    const caisse = body.assets.accounts.find(a => a.account_code === '571');
    assert.ok(caisse, 'Le compte 571 doit être dans les actifs');
    assert.equal(caisse.balance, -30000);

    // Le compte 401 Fournisseurs est un passif → doit être dans liabilities
    const fournisseurs = body.liabilities.accounts.find(a => a.account_code === '401');
    assert.ok(fournisseurs, 'Le compte 401 doit être dans le passif');

    // Cohérence : net_position = total actif - total passif
    const expectedNet = body.assets.total - body.liabilities.total;
    assert.ok(Math.abs(body.net_position - expectedNet) < 0.001, 
      `net_position (${body.net_position}) doit valoir assets.total - liabilities.total (${expectedNet})`);
  });

  test('GET /api/company renvoie les informations de l entreprise et le régime TVA', async () => {
    const res = await fetch(`${BASE_URL}/api/company`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, 'demo-senegal');
    assert.equal(body.name, 'Boutique Dakar SARL');
    assert.equal(body.country, 'Sénégal');
    assert.equal(body.regime_tva, 'non-assujetti');
    assert.equal(body.currency, 'FCFA');
    assert.equal(body.owner_name, 'Ibrahima Sow');
  });

  test('PUT /api/company met à jour les informations et permet de basculer le régime TVA', async () => {
    const updatePayload = {
      name: 'Boutique Dakar & Frères SAS',
      country: 'Sénégal',
      regime_tva: 'assujetti',
      tva_rate: 18,
      currency: 'FCFA',
      ninea: 'SN-DKR-2026-B-12345',
      phone: '+221770001122',
      address: 'Marché Sandaga, Dakar',
      legal_form: 'SAS',
      activity: 'Confection et vente de pagnes wax',
      owner_name: 'Ibrahima Sow Gérant',
      owner_whatsapp: '+221770001122'
    };

    const res = await fetch(`${BASE_URL}/api/company`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatePayload)
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.company.name, 'Boutique Dakar & Frères SAS');
    assert.equal(body.company.regime_tva, 'assujetti');
    assert.equal(body.company.tva_rate, 18);
    assert.equal(body.company.ninea, 'SN-DKR-2026-B-12345');
    assert.equal(body.company.owner_name, 'Ibrahima Sow Gérant');
  });

  test('GET /api/reports/vat calcule le rapport TVA selon le régime actif', async () => {
    const res = await fetch(`${BASE_URL}/api/reports/vat`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.is_assujetti, true);
    assert.equal(body.tva_rate, 18);
    assert.equal(typeof body.vat_collected, 'number');
    assert.equal(typeof body.vat_deductible, 'number');
    assert.equal(typeof body.net_vat, 'number');
  });

  test('GET /api/dashboard/stats renvoie les indicateurs clés du tableau de bord', async () => {
    const res = await fetch(`${BASE_URL}/api/dashboard/stats`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.company);
    assert.equal(typeof body.caisse, 'number');
    assert.equal(typeof body.banque, 'number');
    assert.equal(typeof body.revenus, 'number');
    assert.equal(typeof body.charges, 'number');
    assert.equal(typeof body.resultat, 'number');
    assert.equal(typeof body.total_entries, 'number');
  });

  test('RATE LIMIT : 31 requêtes rapides sur POST /api/messages → la 31ème renvoie 429', async () => {
    // Envoyer 31 requêtes invalides (422) en rafale pour déclencher le rate limit
    // Note : le rate limiter est par IP. En test local 127.0.0.1, le compteur partagé
    // peut déjà avoir des appels des tests précédents. On utilise un message bidon.
    const promises = [];
    for (let i = 0; i < 31; i++) {
      promises.push(
        fetch(`${BASE_URL}/api/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `test rate limit ${i}` })
        })
      );
    }
    const responses = await Promise.all(promises);
    const statusCodes = responses.map(r => r.status);
    // Au moins une réponse doit être 429 (rate limit atteint)
    const has429 = statusCodes.includes(429);
    assert.ok(has429, `Aucun 429 reçu sur 31 requêtes rapides. Status codes : ${statusCodes.join(',')}`);
  });
});
