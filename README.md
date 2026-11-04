# NAFA SaaS - Comptabilité TPE/PME (Plan SYSCOHADA Révisé Étendu)

**NAFA SaaS** est une solution locale et autonome de comptabilité en partie double spécialement conçue pour les Très Petites et Moyennes Entreprises (TPE/PME) de l'espace OHADA (Organisation pour l'Harmonisation en Afrique du Droit des Affaires).

> **Étymologie & Identité :** *« Nafa »* signifie **profit, bénéfice, gain et valeur ajoutée** en wolof et dans les langues d'Afrique de l'Ouest. Le logo de NAFA SaaS allie les deux piliers de l'écriture en partie double (Débit et Crédit) sous la forme d'un **N** stylisé et intègre en son cœur un **Cauri d'or**, monnaie traditionnelle et symbole séculaire de prospérité commerciale en Afrique subsaharienne.

Entreprise de démonstration configurée : **Boutique Dakar SARL** (Dakar, Sénégal, devise FCFA/XOF, régime fiscal non assujetti à la TVA).

---

## 1. Principe architectural strict

> **« L'IA traduit, le code calcule. »**

- **Calculs et règles déterministes prioritaires** : Les montants, l'équilibre en partie double (Débit = Crédit) et les comptes comptables sont toujours calculés et validés par du code JavaScript déterministe.
- **Rôle du LLM** : L'IA n'intervient qu'en cas d'échec du moteur de règles déterministes (`matched: false`).
- **Support Multi-LLM** : Compatible **Google Gemini** (`gemini-2.5-flash` via API REST native) et **Anthropic Claude** (`claude-sonnet-5-5` via `@anthropic-ai/sdk`), avec bascule et détection automatique des clés d'environnement.
- **Validation inviolable** : Aucune donnée issue de l'IA n'est insérée en base de données sans validation préalable par le code (comptes présents dans la liste blanche, montant fini strictement positif, débit différent du crédit, score de confiance valide, types d'écritures reconnus).

---

## 2. Stack technique

- **Runtime** : Node.js 22 (`"type": "module"`)
- **Serveur API** : Express 4 (`express`)
- **Base de données** : SQLite synchrone via `better-sqlite3` (pas de callbacks, exécution séquentielle, transactions atomiques ACID)
- **Configuration** : `dotenv` pour le chargement des variables d'environnement (`.env`)
- **Repli IA Multi-Fournisseurs** :
  - Google Gemini via fetch natif Node 22 (sans dépendance superflue)
  - Anthropic Claude via `@anthropic-ai/sdk`
  - Timeout strict de 15 secondes
- **Frontend** : Fichier unique `public/index.html` en HTML5, CSS3 responsive (mode Nuit/Jour) et JavaScript vanilla (sans build step)
- **Tests** : Test runner natif Node.js (`node:test` et `node:assert/strict`)

---

## 3. Plan de comptes SYSCOHADA étendu (32 comptes)

Le plan comptable couvre l'ensemble des opérations de la vie des affaires d'une TPE/PME de l'espace OHADA :

| Code | Libellé du compte | Type | Classe |
|---|---|---|---|
| **101** | Capital social | Passif | 1 |
| **104** | Compte de l'exploitant | Passif | 1 |
| **162** | Emprunts et dettes financières | Passif | 1 |
| **241** | Matériel et outillage industriel et commercial | Actif | 2 |
| **244** | Matériel et mobilier de bureau et informatique | Actif | 2 |
| **245** | Matériel de transport | Actif | 2 |
| **401** | Fournisseurs | Passif | 4 |
| **411** | Clients | Actif | 4 |
| **422** | Personnel - Avances et acomptes | Actif | 4 |
| **521** | Banque & Mobile Money (Wave / OM) | Actif | 5 |
| **571** | Caisse (Espèces) | Actif | 5 |
| **585** | Virements de fonds internes | Actif | 5 |
| **601** | Achats de marchandises | Charge | 6 |
| **604** | Fournitures de bureau | Charge | 6 |
| **6051** | Carburant | Charge | 6 |
| **6053** | Électricité et eau | Charge | 6 |
| **613** | Loyers et locations | Charge | 6 |
| **615** | Entretien et réparations | Charge | 6 |
| **622** | Rémunérations d'intermédiaires et honoraires | Charge | 6 |
| **624** | Transports et livraisons | Charge | 6 |
| **625** | Primes d'assurances | Charge | 6 |
| **626** | Télécommunications & Internet | Charge | 6 |
| **627** | Publicité, publications et relations publiques | Charge | 6 |
| **628** | Gardiennage, sécurité et entretien locaux | Charge | 6 |
| **631** | Frais bancaires et commissions Wave / OM | Charge | 6 |
| **641** | Salaires du personnel | Charge | 6 |
| **646** | Impôts et taxes directs, patentes | Charge | 6 |
| **671** | Intérêts des emprunts | Charge | 6 |
| **701** | Ventes de marchandises | Produit | 7 |
| **706** | Prestations de services | Produit | 7 |
| **754** | Revenus des locations et sous-locations | Produit | 7 |
| **771** | Intérêts et produits financiers | Produit | 7 |

---

## 4. Typologie des opérations prises en charge

Le moteur de règles et le LLM reconnaissent automatiquement :

1. **Ventes & Produits** :
   - Vente de marchandises (ex: `Vendu pagnes 45000 cash` → 571 / 701)
   - Prestations de services (ex: `Encaisse prestations couture 25000` → 571 / 706)
   - Sous-locations perçues (ex: `Recu loyer sous location 50000` → 571 / 754)
2. **Achats & Approvisionnements** :
   - Marchandises au comptant ou à crédit (ex: `Acheté stock assortiment 120000 crédit fournisseur` → 601 / 401)
   - Fournitures de bureau (ex: `Acheté fournitures papier et stylos 8000` → 604 / 571)
   - Règlements fournisseurs (ex: `Paye fournisseur Adama 50000` → 401 / 571)
3. **Investissements & Immobilisations (Classe 2)** :
   - Informatique et mobilier (ex: `Achat ordinateur portable 250000 cash` → 244 / 571)
   - Outillage d'exploitation (ex: `Achat machine a coudre 150000` → 241 / 571)
   - Véhicules de livraison (ex: `Achat moto livraison 650000 virement` → 245 / 521)
4. **Trésorerie & Virements Internes** :
   - Approvisionnement de caisse (ex: `Retrait banque pour alimenter caisse 100000` → 571 / 521)
   - Dépôt en banque (ex: `Depot especes a la banque 200000` → 521 / 571)
   - Recharges et transferts Mobile Money (ex: `Transfert caisse vers wave 50000` → 521 / 571)
5. **Charges Opérationnelles & Frais Financiers** :
   - Frais Wave et Orange Money (ex: `Frais de retrait wave 1500` → 631 / 521)
   - Honoraires comptable et avocat (ex: `Honoraires comptable 50000` → 622 / 571)
   - Primes d'assurance (ex: `Assurance boutique 60000` → 625 / 571)
   - Publicité Facebook & réseaux sociaux (ex: `Publicite facebook 15000` → 627 / 571)
   - Patente municipale & impôts (ex: `Patente annuelle 60000` → 646 / 571)
   - Gardiennage et nettoyage (ex: `Gardiennage boutique 30000` → 628 / 571)
   - Loyers, salaires, carburant, Senelec, télécoms, etc.
6. **Capitaux, Emprunts & Tiers** :
   - Apports de capital (ex: `Apport de capital 500000 cash` → 571 / 101, ou en notation million `Apport personnel 1.5m cash`)
   - Prélèvements de l'exploitant (ex: `Retrait personnel exploitant 40000` → 104 / 571)
   - Emprunts bancaires et remboursements (ex: `Obtenu pret bancaire 2000000` → 521 / 162 ; `Remboursement pret bancaire 150000` → 162 / 521)
   - Avances sur salaires (ex: `Avance sur salaire employe 25000` → 422 / 571)
   - Recouvrement créance client (ex: `Client Amadou a paye sa dette 40000` → 571 / 411)

---

## 5. Démarrage et commandes

```bash
# Initialiser la base de données (32 comptes SYSCOHADA)
npm run init-db

# Remettre à zéro les opérations comptables
npm run reset

# Peupler les écritures de démonstration
npm run seed

# Lancer la suite de tests unitaires et d'intégration
npm test

# Démarrer le serveur HTTP local
npm start
# -> Accessible sur http://localhost:5000
```
