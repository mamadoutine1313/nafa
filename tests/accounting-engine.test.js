import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AccountingEngine } from '../src/accounting-engine.js';
import { validateAiResponse } from '../src/ai-fallback.js';

describe('AccountingEngine - Règles déterministes SYSCOHADA', () => {
  const engine = new AccountingEngine();

  // 1. Tests des 17 cas obligatoires de la Section 4
  const section4Cases = [
    {
      message: 'Vendu pagnes 45000 cash',
      debit: '571',
      credit: '701',
      type: 'vente',
      expectedAmount: 45000
    },
    {
      message: "J'ai vendu pour 45 000 FCFA de pagnes ce matin, paye cash",
      debit: '571',
      credit: '701',
      type: 'vente',
      expectedAmount: 45000
    },
    {
      message: 'Reçu paiement client Mohamed 30000 virement',
      debit: '521',
      credit: '701',
      type: 'vente',
      expectedAmount: 30000
    },
    {
      message: 'Encaisse prestations couture 25000',
      debit: '571',
      credit: '706',
      type: 'vente',
      expectedAmount: 25000
    },
    {
      message: 'Acheté riz et huile au marché 80000',
      debit: '601',
      credit: '571',
      type: 'achat',
      expectedAmount: 80000
    },
    {
      message: 'Acheté stock assortiment 120000 crédit fournisseur',
      debit: '601',
      credit: '401',
      type: 'achat',
      expectedAmount: 120000
    },
    {
      message: 'Acheté fournitures papier et stylos 8000',
      debit: '604',
      credit: '571',
      type: 'achat',
      expectedAmount: 8000
    },
    {
      message: 'Paye fournisseur Adama 50000',
      debit: '401',
      credit: '571',
      type: 'achat',
      expectedAmount: 50000
    },
    {
      message: 'Loyer boutique 75000',
      debit: '613',
      credit: '571',
      type: 'charge',
      expectedAmount: 75000
    },
    {
      message: 'Salaire employé Ibrahima 100000',
      debit: '641',
      credit: '571',
      type: 'charge',
      expectedAmount: 100000
    },
    {
      message: 'Carburant moto ce matin 10000',
      debit: '6051',
      credit: '571',
      type: 'charge',
      expectedAmount: 10000
    },
    {
      message: 'Facture électricité Senelec 25000',
      debit: '6053',
      credit: '571',
      type: 'charge',
      expectedAmount: 25000
    },
    {
      message: 'Recharge téléphone 5000',
      debit: '626',
      credit: '571',
      type: 'charge',
      expectedAmount: 5000
    },
    {
      message: 'Frais transport marchandises 12000',
      debit: '624',
      credit: '571',
      type: 'charge',
      expectedAmount: 12000
    },
    {
      message: 'Paye électricien réparation 15000',
      debit: '615',
      credit: '571',
      type: 'charge',
      expectedAmount: 15000
    },
    {
      message: 'Facture électricité du mois : 25 000 FCFA par virement',
      debit: '6053',
      credit: '521',
      type: 'charge',
      expectedAmount: 25000
    }
  ];

  for (const c of section4Cases) {
    test(`Section 4: "${c.message}"`, () => {
      const res = engine.processRules(c.message);
      assert.equal(res.matched, true, `Le message "${c.message}" aurait dû matcher`);
      assert.equal(res.compte_debit, c.debit, `Débit attendu ${c.debit}, obtenu ${res.compte_debit}`);
      assert.equal(res.compte_credit, c.credit, `Crédit attendu ${c.credit}, obtenu ${res.compte_credit}`);
      assert.equal(res.type, c.type, `Type attendu ${c.type}, obtenu ${res.type}`);
      assert.equal(res.montant, c.expectedAmount, `Montant attendu ${c.expectedAmount}, obtenu ${res.montant}`);
      assert.equal(res.devise, 'FCFA');
      assert.ok(res.confiance >= 0.85 && res.confiance <= 1.0);
    });
  }

  test('Section 4: "bonjour comment ça va" ne doit pas matcher', () => {
    const res = engine.processRules('bonjour comment ça va');
    assert.equal(res.matched, false);
  });

  // 2. Tests spécifiques d'extraction des montants
  describe('Extraction des montants', () => {
    test('Règle "2 sacs 30000" ne doit pas fusionner en 230000', () => {
      const amount = engine.extractAmount('2 sacs 30000');
      assert.equal(amount, 30000, 'Doit choisir 30000 et non 230000 ou 2');
    });

    test('Accepte "45k"', () => {
      const amount = engine.extractAmount('vente pagnes 45k cash');
      assert.equal(amount, 45000);
    });

    test('Accepte "45 000"', () => {
      const amount = engine.extractAmount('vente pagnes 45 000 cash');
      assert.equal(amount, 45000);
    });

    test('Accepte "45.000"', () => {
      const amount = engine.extractAmount('vente pagnes 45.000 cash');
      assert.equal(amount, 45000);
    });

    test('Accepte "45,5"', () => {
      const amount = engine.extractAmount('vente pagnes 45,5 cash');
      assert.equal(amount, 45.5);
    });

    test('Préfère le nombre suivi de FCFA', () => {
      const amount = engine.extractAmount('commande de 10 articles pour 50000 FCFA');
      assert.equal(amount, 50000);
    });

    test('Montant nul ou absent renvoie null', () => {
      assert.equal(engine.extractAmount('salut les amis'), null);
      assert.equal(engine.extractAmount(''), null);
      assert.equal(engine.extractAmount(null), null);
    });
  });

  // 3. Tests des 20 messages de seed
  describe('Vérification des 20 messages de seed', () => {
    const seedMessages = [
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

    let totalSeed = 0;
    for (let i = 0; i < seedMessages.length; i++) {
      const msg = seedMessages[i];
      test(`Seed #${i + 1}: "${msg}"`, () => {
        const res = engine.processRules(msg);
        assert.equal(res.matched, true, `Le message de seed #${i + 1} "${msg}" doit être reconnu`);
        totalSeed += res.montant;
      });
    }

    test('Total des 20 écritures de seed doit égaler exactement 883 000 FCFA', () => {
      let sum = 0;
      for (const msg of seedMessages) {
        const res = engine.processRules(msg);
        sum += res.montant;
      }
      assert.equal(sum, 883000, `La somme doit être 883000 FCFA, obtenu : ${sum}`);
    });
  });
});

describe('AI Fallback - Contrôles de validation stricts', () => {
  test('Réponse valide de Claude acceptée', () => {
    const validRaw = JSON.stringify({
      type: 'vente',
      montant: 45000,
      moyen: 'especes',
      compte_debit: '571',
      compte_credit: '701',
      libelle: 'Vente pagnes',
      confiance: 0.95
    });

    const res = validateAiResponse(validRaw);
    assert.equal(res.valid, true);
    assert.equal(res.data.compte_debit, '571');
    assert.equal(res.data.compte_credit, '701');
    assert.equal(res.data.montant, 45000);
    assert.equal(res.data.source, 'ai-fallback');
  });

  test('Rejet si compte inconnu non présent dans la liste blanche (ex: 999)', () => {
    const invalidAccount = JSON.stringify({
      type: 'vente',
      montant: 45000,
      moyen: 'especes',
      compte_debit: '999',
      compte_credit: '701',
      libelle: 'Compte inconnu',
      confiance: 0.9
    });

    const res = validateAiResponse(invalidAccount);
    assert.equal(res.valid, false);
    assert.match(res.error, /non autorisé ou inconnu/);
  });

  test('Rejet si débit == crédit (ex: 571 == 571)', () => {
    const sameDebitCredit = JSON.stringify({
      type: 'charge',
      montant: 10000,
      moyen: 'especes',
      compte_debit: '571',
      compte_credit: '571',
      libelle: 'Débit égal crédit',
      confiance: 0.8
    });

    const res = validateAiResponse(sameDebitCredit);
    assert.equal(res.valid, false);
    assert.match(res.error, /ne peut pas être identique/);
  });

  test('Rejet si montant négatif ou zéro', () => {
    const zeroAmount = JSON.stringify({
      type: 'vente',
      montant: 0,
      moyen: 'especes',
      compte_debit: '571',
      compte_credit: '701',
      libelle: 'Montant nul',
      confiance: 0.9
    });

    const res = validateAiResponse(zeroAmount);
    assert.equal(res.valid, false);
    assert.match(res.error, /Montant invalide/);
  });

  test('Rejet si confiance hors bornes [0, 1]', () => {
    const badConfidence = JSON.stringify({
      type: 'vente',
      montant: 20000,
      moyen: 'especes',
      compte_debit: '571',
      compte_credit: '701',
      libelle: 'Confiance invalide',
      confiance: 1.5
    });

    const res = validateAiResponse(badConfidence);
    assert.equal(res.valid, false);
    assert.match(res.error, /Confiance invalide/);
  });

  test('Rejet si chaîne JSON non valide', () => {
    const res = validateAiResponse('Ceci n est pas du json');
    assert.equal(res.valid, false);
    assert.match(res.error, /JSON invalide/);
  });

  test('Validation acceptée pour les nouveaux comptes (244, 241, 101, 631, etc.)', () => {
    const validNewAccount = JSON.stringify({
      type: 'immobilisation',
      montant: 250000,
      moyen: 'especes',
      compte_debit: '244',
      compte_credit: '571',
      libelle: 'Acquisition ordinateur portable',
      confiance: 0.95
    });

    const res = validateAiResponse(validNewAccount);
    assert.equal(res.valid, true);
    assert.equal(res.data.compte_debit, '244');
    assert.equal(res.data.type, 'immobilisation');
    assert.equal(res.data.montant, 250000);
  });

  test('Validation acceptée pour les opérations de trésorerie interne', () => {
    const validTresorerie = JSON.stringify({
      type: 'tresorerie',
      montant: 100000,
      moyen: 'virement',
      compte_debit: '571',
      compte_credit: '521',
      libelle: 'Alimentation caisse par banque',
      confiance: 0.98
    });

    const res = validateAiResponse(validTresorerie);
    assert.equal(res.valid, true);
    assert.equal(res.data.type, 'tresorerie');
    assert.equal(res.data.compte_debit, '571');
    assert.equal(res.data.compte_credit, '521');
  });
});

describe('AccountingEngine - Nouvelles opérations étendues SYSCOHADA TPE/PME', () => {
  const engine = new AccountingEngine();

  const newCases = [
    // Immobilisations
    {
      message: 'Achat ordinateur portable 250000 cash',
      debit: '244',
      credit: '571',
      type: 'immobilisation',
      expectedAmount: 250000
    },
    {
      message: 'Achat machine a coudre 150000',
      debit: '241',
      credit: '571',
      type: 'immobilisation',
      expectedAmount: 150000
    },
    {
      message: 'Achat moto livraison 650000 virement',
      debit: '245',
      credit: '521',
      type: 'immobilisation',
      expectedAmount: 650000
    },
    // Trésorerie interne
    {
      message: 'Retrait banque pour alimenter caisse 100000',
      debit: '571',
      credit: '521',
      type: 'tresorerie',
      expectedAmount: 100000
    },
    {
      message: 'Depot especes a la banque 200000',
      debit: '521',
      credit: '571',
      type: 'tresorerie',
      expectedAmount: 200000
    },
    {
      message: 'Transfert caisse vers wave 50000',
      debit: '521',
      credit: '571',
      type: 'tresorerie',
      expectedAmount: 50000
    },
    // Frais financiers / Wave
    {
      message: 'Frais de retrait wave 1500',
      debit: '631',
      credit: '521',
      type: 'charge',
      expectedAmount: 1500
    },
    {
      message: 'Frais bancaires 2500 virement',
      debit: '631',
      credit: '521',
      type: 'charge',
      expectedAmount: 2500
    },
    // Honoraires
    {
      message: 'Honoraires comptable 50000',
      debit: '622',
      credit: '571',
      type: 'charge',
      expectedAmount: 50000
    },
    {
      message: 'Frais avocat 75000 virement',
      debit: '622',
      credit: '521',
      type: 'charge',
      expectedAmount: 75000
    },
    // Assurances
    {
      message: 'Assurance boutique 60000',
      debit: '625',
      credit: '571',
      type: 'charge',
      expectedAmount: 60000
    },
    // Publicité
    {
      message: 'Publicite facebook 15000',
      debit: '627',
      credit: '571',
      type: 'charge',
      expectedAmount: 15000
    },
    // Gardiennage
    {
      message: 'Gardiennage boutique 30000',
      debit: '628',
      credit: '571',
      type: 'charge',
      expectedAmount: 30000
    },
    // Impôts et patentes
    {
      message: 'Patente annuelle 60000',
      debit: '646',
      credit: '571',
      type: 'charge',
      expectedAmount: 60000
    },
    // Intérêts
    {
      message: 'Interets pret bancaire 15000',
      debit: '671',
      credit: '521',
      type: 'charge',
      expectedAmount: 15000
    },
    // Capital et Emprunts
    {
      message: 'Apport de capital 500000 cash',
      debit: '571',
      credit: '101',
      type: 'capital',
      expectedAmount: 500000
    },
    {
      message: 'Retrait personnel exploitant 40000',
      debit: '104',
      credit: '571',
      type: 'capital',
      expectedAmount: 40000
    },
    {
      message: 'Obtenu pret bancaire 2000000',
      debit: '521',
      credit: '162',
      type: 'emprunt',
      expectedAmount: 2000000
    },
    {
      message: 'Remboursement pret bancaire 150000',
      debit: '162',
      credit: '521',
      type: 'emprunt',
      expectedAmount: 150000
    },
    // Tiers & Salaires
    {
      message: 'Avance sur salaire employe 25000',
      debit: '422',
      credit: '571',
      type: 'charge',
      expectedAmount: 25000
    },
    {
      message: 'Client Amadou a paye sa dette 40000',
      debit: '571',
      credit: '411',
      type: 'reglement_client',
      expectedAmount: 40000
    },
    // Produits
    {
      message: 'Recu loyer sous location 50000',
      debit: '571',
      credit: '754',
      type: 'produit',
      expectedAmount: 50000
    },
    // Montants en millions
    {
      message: 'Apport personnel 1.5m cash',
      debit: '571',
      credit: '101',
      type: 'capital',
      expectedAmount: 1500000
    }
  ];

  for (const c of newCases) {
    test(`Opération : "${c.message}"`, () => {
      const res = engine.processRules(c.message);
      assert.equal(res.matched, true, `Le message "${c.message}" aurait dû être reconnu`);
      assert.equal(res.type, c.type, `Mauvais type pour "${c.message}"`);
      assert.equal(res.compte_debit, c.debit, `Mauvais compte de débit pour "${c.message}"`);
      assert.equal(res.compte_credit, c.credit, `Mauvais compte de crédit pour "${c.message}"`);
      assert.equal(res.montant, c.expectedAmount, `Mauvais montant extrait pour "${c.message}"`);
      assert.ok(res.confiance >= 0.85, 'Confiance insuffisante');
    });
  }
});
