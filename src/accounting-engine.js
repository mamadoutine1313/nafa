/**
 * Moteur de règles déterministes SYSCOHADA révisé - Version Étendue TPE/PME
 * 
 * Principes stricts :
 * - L'IA traduit, le code calcule
 * - Normalisation stricte sans accents
 * - Aucun ancrage regex en début de phrase
 * - Montants calculés et vérifiés par le code
 * - Couverture complète des flux opérationnels, d'investissement, de financement et de trésorerie
 */

export class AccountingEngine {
  /**
   * Normalise le texte en minuscules, sans accents, apostrophes remplacées par des espaces
   * @param {string} text 
   * @returns {string}
   */
  normalize(text) {
    if (!text || typeof text !== 'string') return '';
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Retrait des diacritiques
      .toLowerCase()
      .replace(/['’]/g, ' ')           // Apostrophes remplacées par des espaces
      .replace(/[\r\n\t]+/g, ' ')
      .trim();
  }

  /**
   * Extrait le montant selon les règles imposées :
   * - Accepte 45000, 45 000, 45.000, 45,5, 45k, 1.5m, avec ou sans FCFA, F, frs
   * - Si plusieurs nombres, préférer celui suivi de FCFA ; sinon le plus grand
   * - Ne pas fusionner deux nombres séparés par un mot (« 2 sacs 30000 » ne devient pas 230000)
   * - Montant nul ou absent => non reconnu (null)
   * @param {string} normalizedText 
   * @returns {number|null}
   */
  extractAmount(normalizedText) {
    if (!normalizedText) return null;

    // Détection de tous les candidats numériques
    // 1. Notation million 'm' (ex: 1.5m, 2m)
    // 2. Notation millier 'k' (ex: 45k, 45.5k, 45,5k)
    // 3. Séparateur de milliers par espace (ex: 45 000, 120 000)
    // 4. Séparateur de milliers par point (ex: 45.000, 120.000)
    // 5. Décimale par virgule (ex: 45,5)
    // 6. Entier standard (ex: 45000, 2, 8000)
    const candidateRegex = /\b(\d+(?:[.,]\d+)?)\s*m\b|\b(\d+(?:[.,]\d+)?)\s*k\b|\b(\d{1,3}(?: \d{3})+)\b|\b(\d{1,3}(?:\.\d{3})+)\b|\b(\d+,\d+)\b|\b(\d+)\b/gi;
    
    const candidates = [];
    let match;

    while ((match = candidateRegex.exec(normalizedText)) !== null) {
      const matchIndex = match.index;
      const matchLength = match[0].length;
      let rawVal = match[0];
      let numVal = 0;

      if (match[1] !== undefined) {
        // Notation 'm' (ex: 1.5m => 1500000)
        numVal = parseFloat(match[1].replace(',', '.')) * 1000000;
      } else if (match[2] !== undefined) {
        // Notation 'k' (ex: 45k => 45000)
        numVal = parseFloat(match[2].replace(',', '.')) * 1000;
      } else if (match[3] !== undefined) {
        // Espace séparateur de milliers (ex: 45 000 => 45000)
        numVal = parseFloat(match[3].replace(/\s+/g, ''));
      } else if (match[4] !== undefined) {
        // Point séparateur de milliers (ex: 45.000 => 45000)
        numVal = parseFloat(match[4].replace(/\./g, ''));
      } else if (match[5] !== undefined) {
        // Virgule décimale (ex: 45,5 => 45.5)
        numVal = parseFloat(match[5].replace(',', '.'));
      } else if (match[6] !== undefined) {
        // Entier standard (ex: 45000 ou 2)
        numVal = parseFloat(match[6]);
      }

      if (!Number.isFinite(numVal) || numVal <= 0) {
        continue;
      }

      // Vérifier si le nombre est suivi d'un indicateur de devise FCFA / F / frs / cfa
      const afterText = normalizedText.slice(matchIndex + matchLength).trimStart();
      const hasCurrency = /^(fcfa|cfa|frs|francs|f\b)/i.test(afterText);

      candidates.push({
        value: numVal,
        hasCurrency,
        index: matchIndex,
        raw: rawVal
      });
    }

    if (candidates.length === 0) {
      return null;
    }

    // Règle : Si plusieurs nombres, préférer celui suivi de FCFA ; sinon le plus grand
    const currencyCandidates = candidates.filter(c => c.hasCurrency);
    if (currencyCandidates.length > 0) {
      currencyCandidates.sort((a, b) => b.value - a.value);
      return currencyCandidates[0].value;
    }

    // Sinon le plus grand de tous les candidats
    candidates.sort((a, b) => b.value - a.value);
    return candidates[0].value;
  }

  /**
   * Analyse le message et applique les règles SYSCOHADA
   * @param {string} message 
   * @returns {Object}
   */
  processRules(message) {
    if (!message || typeof message !== 'string') {
      return { matched: false };
    }

    const norm = this.normalize(message);
    if (!norm) {
      return { matched: false };
    }

    // 1. Extraction du montant
    const montant = this.extractAmount(norm);
    if (montant === null || montant <= 0) {
      return { matched: false };
    }

    // 2. Détection du mode de paiement
    // virement, wave, orange money, mobile money, banque, chèque -> 521
    // cash, espèces, main, comptant, liquide -> 571
    // crédit fournisseur / crédit client -> 401 / 411
    const hasVirement = /\b(virement|wave|orange money|om\b|free money|mobile money|banque|cheque|bancaire|compte bancaire)\b/.test(norm);
    const hasCash = /\b(cash|especes|main|comptant|liquide)\b/.test(norm);
    const hasCredit = /\b(credit fournisseur|a credit|credit client|a terme)\b/.test(norm);

    let defaultTreasury = '571';
    let moyen = 'especes';
    let confiance = 0.85;

    if (hasVirement) {
      defaultTreasury = '521';
      moyen = 'virement';
      confiance = 0.97;
    } else if (hasCash) {
      defaultTreasury = '571';
      moyen = 'especes';
      confiance = 0.97;
    } else if (hasCredit) {
      moyen = 'credit';
      confiance = 0.97;
    }

    // -------------------------------------------------------------
    // SECTION 4 - PRIORITÉS ESSENTIELLES DU CAHIER DES CHARGES
    // -------------------------------------------------------------

    // PRIORITÉ 1 : Règlement fournisseur
    // (« paye fournisseur », « reglement fournisseur », etc.)
    if (/\b(regle|paiement|reglement)\s+fournisseur\b|\bpaye\s+fournisseur\b/.test(norm)) {
      return {
        matched: true,
        type: 'achat',
        montant,
        devise: 'FCFA',
        moyen,
        compte_debit: '401',
        compte_credit: defaultTreasury,
        libelle: `Reglement fournisseur - ${montant} FCFA`,
        confiance,
        source: 'deterministic-rules',
        rule_matched: 'reglement-fournisseur'
      };
    }

    // PRIORITÉ 1-B : Transferts et virements internes de trésorerie (Caisse <-> Banque / Mobile Money)
    // Retrait banque pour alimenter caisse
    if (/\b(retrait|alimente|alimentation|approvisionnement)\s+(de\s+la\s+banque|du\s+compte|banque)\s+(pour\s+|vers\s+)?(caisse|especes)?\b|\b(retrait\s+banque\s+(pour|vers)\s+caisse)\b/.test(norm) ||
        (/\bretrait\s+banque\b/.test(norm) && /\bcaisse\b/.test(norm))) {
      return {
        matched: true,
        type: 'tresorerie',
        montant,
        devise: 'FCFA',
        moyen: 'virement',
        compte_debit: '571',
        compte_credit: '521',
        libelle: `Alimentation caisse par retrait banque - ${montant} FCFA`,
        confiance: 0.98,
        source: 'deterministic-rules',
        rule_matched: 'tresorerie-banque-vers-caisse'
      };
    }

    // Dépôt espèces en banque / versement caisse vers banque ou Wave
    if (/\b(depot|versement)\s+(especes?|caisse)\s+(a\s+la\s+banque|en\s+banque|sur\s+compte|vers\s+banque|sur\s+wave)\b|\bversement\s+banque\b|\bdepot\s+en\s+banque\b/.test(norm)) {
      return {
        matched: true,
        type: 'tresorerie',
        montant,
        devise: 'FCFA',
        moyen: 'virement',
        compte_debit: '521',
        compte_credit: '571',
        libelle: `Versement especes en banque - ${montant} FCFA`,
        confiance: 0.98,
        source: 'deterministic-rules',
        rule_matched: 'tresorerie-caisse-vers-banque'
      };
    }

    // Transfert caisse vers Wave / OM
    if (/\b(transfert|recharge)\s+(caisse\s+vers\s+(wave|orange money|om)|vers\s+(wave|orange money))\b/.test(norm)) {
      return {
        matched: true,
        type: 'tresorerie',
        montant,
        devise: 'FCFA',
        moyen: 'virement',
        compte_debit: '521',
        compte_credit: '571',
        libelle: `Transfert caisse vers mobile money - ${montant} FCFA`,
        confiance: 0.98,
        source: 'deterministic-rules',
        rule_matched: 'tresorerie-caisse-vers-mobile-money'
      };
    }

    // PRIORITÉ 1-C : Règlements de créance client (dette antérieure / reliquat)
    // ATTENTION : "Reçu paiement client Mohamed 30000 virement" (Section 4) n'a PAS le mot dette/creance -> traité en Vente 701.
    // Si explicitement mention de dette / créance / reliquat : Débit trésorerie, Crédit 411
    if (/\b(regle|reglement|paye|recouvrement)\s+(sa\s+)?(dette|creance|reliquat|facture anterieure)\b|\b(client\s+\w+\s+a\s+paye\s+sa\s+dette)\b/.test(norm)) {
      return {
        matched: true,
        type: 'reglement_client',
        montant,
        devise: 'FCFA',
        moyen,
        compte_debit: defaultTreasury,
        compte_credit: '411',
        libelle: `Reglement creance client - ${montant} FCFA`,
        confiance,
        source: 'deterministic-rules',
        rule_matched: 'reglement-creance-client'
      };
    }

    // PRIORITÉ 1-D : Avances et acomptes sur salaire
    if (/\b(avance|acompte)\s+(sur\s+)?salaire\b/.test(norm)) {
      return {
        matched: true,
        type: 'charge',
        montant,
        devise: 'FCFA',
        moyen,
        compte_debit: '422',
        compte_credit: defaultTreasury,
        libelle: `Avance sur salaire - ${montant} FCFA`,
        confiance,
        source: 'deterministic-rules',
        rule_matched: 'avance-salaire'
      };
    }

    // PRIORITÉ 1-E : Opérations de Capital et Financement (Classe 1)
    // Apport de capital / investissement personnel
    if (/\b(apport\s+(de\s+|en\s+)?capital|apport\s+personnel|capital\s+social|investissement\s+capital)\b/.test(norm)) {
      return {
        matched: true,
        type: 'capital',
        montant,
        devise: 'FCFA',
        moyen,
        compte_debit: defaultTreasury,
        compte_credit: '101',
        libelle: `Apport de capital - ${montant} FCFA`,
        confiance,
        source: 'deterministic-rules',
        rule_matched: 'apport-capital'
      };
    }

    // Retrait personnel / Prélèvement de l'exploitant
    if (/\b(retrait\s+personnel|prelevement\s+personnel|retrait\s+exploitant|prelevement\s+patron)\b/.test(norm)) {
      return {
        matched: true,
        type: 'capital',
        montant,
        devise: 'FCFA',
        moyen,
        compte_debit: '104',
        compte_credit: defaultTreasury,
        libelle: `Prelevement de l exploitant - ${montant} FCFA`,
        confiance,
        source: 'deterministic-rules',
        rule_matched: 'retrait-exploitant'
      };
    }

    // Emprunt bancaire obtenu
    if (/\b(pret\s+bancaire\s+recu|obtenu\s+(un\s+)?(pret|emprunt|credit)\s+bancaire|emprunt\s+bancaire\s+recu)\b/.test(norm)) {
      return {
        matched: true,
        type: 'emprunt',
        montant,
        devise: 'FCFA',
        moyen: 'virement',
        compte_debit: '521',
        compte_credit: '162',
        libelle: `Encaissement emprunt bancaire - ${montant} FCFA`,
        confiance: 0.98,
        source: 'deterministic-rules',
        rule_matched: 'emprunt-bancaire-recu'
      };
    }

    // Remboursement d'emprunt bancaire
    if (/\bremboursement\s+(du\s+)?(pret|emprunt|credit)\s+bancaire\b/.test(norm)) {
      return {
        matched: true,
        type: 'emprunt',
        montant,
        devise: 'FCFA',
        moyen: 'virement',
        compte_debit: '162',
        compte_credit: '521',
        libelle: `Remboursement emprunt bancaire - ${montant} FCFA`,
        confiance: 0.98,
        source: 'deterministic-rules',
        rule_matched: 'remboursement-emprunt'
      };
    }

    // PRIORITÉ 1-F : Revenus locatifs reçus (sous-location)
    if (/\b(recu|encaisse|encaissement)\s+(le\s+)?loyer\s+(de\s+la\s+)?sous\s*location\b|\bloyer\s+sous\s*location\s+recu\b/.test(norm)) {
      return {
        matched: true,
        type: 'produit',
        montant,
        devise: 'FCFA',
        moyen,
        compte_debit: defaultTreasury,
        compte_credit: '754',
        libelle: `Revenus de sous-location - ${montant} FCFA`,
        confiance,
        source: 'deterministic-rules',
        rule_matched: 'produit-sous-location'
      };
    }

    // PRIORITÉ 2 : Vente
    // (vendu, vente, encaisse, reçu, recette, rentré)
    const isVente = /\b(vendu|vente|ventes|encaisse|encaissement|recu|recette|recettes|rentre|rentree)\b/.test(norm);
    if (isVente) {
      // Déterminer le compte de produit : 706 si prestation/couture/réparation/service, sinon 701
      const isPrestation = /\b(prestation|prestations|couture|reparation|service|services|coiffure|consultation)\b/.test(norm);
      const compte_credit = isPrestation ? '706' : '701';
      const libelleType = isPrestation ? 'Prestations de services' : 'Vente de marchandises';

      // Déterminer le compte de débit : 411 si crédit, sinon trésorerie
      const compte_debit = hasCredit ? '411' : defaultTreasury;

      return {
        matched: true,
        type: 'vente',
        montant,
        devise: 'FCFA',
        moyen,
        compte_debit,
        compte_credit,
        libelle: `${libelleType} - ${montant} FCFA`,
        confiance,
        source: 'deterministic-rules',
        rule_matched: isPrestation ? 'vente-prestations' : 'vente-marchandises'
      };
    }

    // PRIORITÉ 3 : Achat de fournitures
    // (achat + papier, stylo, fourniture, bureau, cahier)
    const hasAchatWord = /\b(achat|achete|achats)\b/.test(norm);
    const hasFournituresWord = /\b(papier|stylo|stylos|fourniture|fournitures|bureau|cahier|cahiers|encre|classeur|classeurs)\b/.test(norm);
    if (hasAchatWord && hasFournituresWord) {
      const compte_credit = hasCredit ? '401' : defaultTreasury;
      return {
        matched: true,
        type: 'achat',
        montant,
        devise: 'FCFA',
        moyen,
        compte_debit: '604',
        compte_credit,
        libelle: `Achat de fournitures - ${montant} FCFA`,
        confiance,
        source: 'deterministic-rules',
        rule_matched: 'achat-fournitures'
      };
    }

    // PRIORITÉ 3-B : Immobilisations (Classe 2)
    // Matériel de transport (moto, scooter, tricycle, camionnette, voiture de service)
    const isTransportAsset = /\b(moto|scooter|tricycle|camionnette|voiture|vehicule)\b/.test(norm) &&
                             /\b(achat|achete|acquisition)\b/.test(norm);
    if (isTransportAsset) {
      const compte_credit = hasCredit ? '401' : defaultTreasury;
      return {
        matched: true,
        type: 'immobilisation',
        montant,
        devise: 'FCFA',
        moyen,
        compte_debit: '245',
        compte_credit,
        libelle: `Acquisition materiel de transport - ${montant} FCFA`,
        confiance,
        source: 'deterministic-rules',
        rule_matched: 'immobilisation-transport'
      };
    }

    // Matériel informatique et mobilier de bureau (ordinateur, laptop, pc, imprimante, smartphone, table, chaise, bureau)
    const isOfficeAsset = /\b(ordinateur|laptop|pc|imprimante|smartphone|telephone de service|tablette|mobilier|etagere|etageres|fauteuil)\b/.test(norm) &&
                          /\b(achat|achete|acquisition)\b/.test(norm);
    if (isOfficeAsset) {
      const compte_credit = hasCredit ? '401' : defaultTreasury;
      return {
        matched: true,
        type: 'immobilisation',
        montant,
        devise: 'FCFA',
        moyen,
        compte_debit: '244',
        compte_credit,
        libelle: `Acquisition materiel et mobilier informatique - ${montant} FCFA`,
        confiance,
        source: 'deterministic-rules',
        rule_matched: 'immobilisation-bureau'
      };
    }

    // Matériel et outillage (machine à coudre, groupe électrogène, congélateur, réfrigérateur, four, balance)
    const isToolsAsset = /\b(machine a coudre|groupe electrogene|congelateur|refrigerateur|frigo|four industriel|balance electronique|outillage)\b/.test(norm) &&
                         /\b(achat|achete|acquisition)\b/.test(norm);
    if (isToolsAsset) {
      const compte_credit = hasCredit ? '401' : defaultTreasury;
      return {
        matched: true,
        type: 'immobilisation',
        montant,
        devise: 'FCFA',
        moyen,
        compte_debit: '241',
        compte_credit,
        libelle: `Acquisition materiel et outillage - ${montant} FCFA`,
        confiance,
        source: 'deterministic-rules',
        rule_matched: 'immobilisation-outillage'
      };
    }

    // PRIORITÉ 4 : Achat de marchandises
    // (achat, acheté, stock, approvisionnement)
    // ATTENTION : « frais transport marchandises » ne doit PAS être classé en achat de marchandises.
    // Le mot « marchandises » seul ne suffit jamais à classer un achat.
    const isAchatMarchandises = /\b(achat|achete|achats|stock|approvisionnement|approvisionnements)\b/.test(norm);
    if (isAchatMarchandises) {
      const compte_credit = hasCredit ? '401' : defaultTreasury;
      return {
        matched: true,
        type: 'achat',
        montant,
        devise: 'FCFA',
        moyen,
        compte_debit: '601',
        compte_credit,
        libelle: `Achat de marchandises - ${montant} FCFA`,
        confiance,
        source: 'deterministic-rules',
        rule_matched: 'achat-marchandises'
      };
    }

    // PRIORITÉ 5 : Charges

    // Frais bancaires et Mobile Money (Wave, Orange Money, agios, tenue de compte)
    if (/\b(frais\s+(bancaires?|de\s+banque)|frais\s+(de\s+)?(wave|orange money|om|transfert|retrait|tenue de compte)|agios|commissions?\s+bancaires?)\b/.test(norm)) {
      return {
        matched: true,
        type: 'charge',
        montant,
        devise: 'FCFA',
        moyen,
        compte_debit: '631',
        compte_credit: defaultTreasury,
        libelle: `Frais bancaires et commissions - ${montant} FCFA`,
        confiance,
        source: 'deterministic-rules',
        rule_matched: 'charge-frais-bancaires'
      };
    }

    // Honoraires et rémunérations d'intermédiaires (comptable, avocat, notaire, juriste, consultant)
    if (/\b(honoraires?|avocat|comptable|expert comptable|notaire|juriste|consultant|courtier)\b/.test(norm)) {
      return {
        matched: true,
        type: 'charge',
        montant,
        devise: 'FCFA',
        moyen,
        compte_debit: '622',
        compte_credit: defaultTreasury,
        libelle: `Honoraires et remunerations intermediaires - ${montant} FCFA`,
        confiance,
        source: 'deterministic-rules',
        rule_matched: 'charge-honoraires'
      };
    }

    // Primes d'assurances (boutique, véhicule, incendie, vol)
    if (/\b(assurance|assurances|prime d assurance)\b/.test(norm)) {
      return {
        matched: true,
        type: 'charge',
        montant,
        devise: 'FCFA',
        moyen,
        compte_debit: '625',
        compte_credit: defaultTreasury,
        libelle: `Primes d assurances - ${montant} FCFA`,
        confiance,
        source: 'deterministic-rules',
        rule_matched: 'charge-assurance'
      };
    }

    // Publicité, marketing, enseignes, sponsoring (Facebook, Instagram, flyers)
    if (/\b(publicite|pub|facebook\s+ads|sponsorisation|sponsorise|flyers|affiches|enseigne\s+publicitaire|marketing)\b/.test(norm)) {
      return {
        matched: true,
        type: 'charge',
        montant,
        devise: 'FCFA',
        moyen,
        compte_debit: '627',
        compte_credit: defaultTreasury,
        libelle: `Publicite et relations publiques - ${montant} FCFA`,
        confiance,
        source: 'deterministic-rules',
        rule_matched: 'charge-publicite'
      };
    }

    // Gardiennage, sécurité et nettoyage locaux
    if (/\b(gardiennage|gardien|vigile|securite|nettoyage|femme de menage|entretien locaux)\b/.test(norm)) {
      return {
        matched: true,
        type: 'charge',
        montant,
        devise: 'FCFA',
        moyen,
        compte_debit: '628',
        compte_credit: defaultTreasury,
        libelle: `Gardiennage et securite - ${montant} FCFA`,
        confiance,
        source: 'deterministic-rules',
        rule_matched: 'charge-gardiennage'
      };
    }

    // Impôts, taxes directes et patentes (patente, mairie, taxes municipales, vignette)
    if (/\b(patente|taxe\s+municipale|taxe\s+de\s+voirie|taxes\s+mairie|vignette|impot\s+synthetique|impots?)\b/.test(norm)) {
      return {
        matched: true,
        type: 'charge',
        montant,
        devise: 'FCFA',
        moyen,
        compte_debit: '646',
        compte_credit: defaultTreasury,
        libelle: `Impots et taxes directs, patente - ${montant} FCFA`,
        confiance,
        source: 'deterministic-rules',
        rule_matched: 'charge-impots-taxes'
      };
    }

    // Intérêts bancaires et des emprunts
    if (/\b(interets?\s+(pret|emprunt|credit|bancaires?)|interets?\s+(du\s+|de\s+|d\s+)?(pret|emprunt|credit|bancaires?)|agios\s+et\s+interets)\b/.test(norm)) {
      return {
        matched: true,
        type: 'charge',
        montant,
        devise: 'FCFA',
        moyen: 'virement',
        compte_debit: '671',
        compte_credit: '521',
        libelle: `Interets des emprunts - ${montant} FCFA`,
        confiance: 0.98,
        source: 'deterministic-rules',
        rule_matched: 'charge-interets-emprunt'
      };
    }

    // Loyers : loyer/location -> 613
    if (/\b(loyer|loyers|location|locations)\b/.test(norm)) {
      return {
        matched: true,
        type: 'charge',
        montant,
        devise: 'FCFA',
        moyen,
        compte_debit: '613',
        compte_credit: defaultTreasury,
        libelle: `Loyers - ${montant} FCFA`,
        confiance,
        source: 'deterministic-rules',
        rule_matched: 'charge-loyer'
      };
    }

    // Entretien et réparations : réparation/entretien -> 615
    // Vérifié avant salaire/paie pour capturer "Paye électricien réparation"
    if (/\b(reparation|reparations|entretien|depannage|electricien|plombier|mecanicien)\b/.test(norm)) {
      return {
        matched: true,
        type: 'charge',
        montant,
        devise: 'FCFA',
        moyen,
        compte_debit: '615',
        compte_credit: defaultTreasury,
        libelle: `Entretien et reparations - ${montant} FCFA`,
        confiance,
        source: 'deterministic-rules',
        rule_matched: 'charge-entretien'
      };
    }

    // Salaires : salaire/paie/employé/ouvrier/personnel -> 641
    if (/\b(salaire|salaires|paie|employe|employes|ouvrier|ouvriers|personnel)\b/.test(norm)) {
      return {
        matched: true,
        type: 'charge',
        montant,
        devise: 'FCFA',
        moyen,
        compte_debit: '641',
        compte_credit: defaultTreasury,
        libelle: `Salaires - ${montant} FCFA`,
        confiance,
        source: 'deterministic-rules',
        rule_matched: 'charge-salaire'
      };
    }

    // Carburant : carburant/essence/gasoil -> 6051
    if (/\b(carburant|essence|gasoil|gazole)\b/.test(norm)) {
      return {
        matched: true,
        type: 'charge',
        montant,
        devise: 'FCFA',
        moyen,
        compte_debit: '6051',
        compte_credit: defaultTreasury,
        libelle: `Carburant - ${montant} FCFA`,
        confiance,
        source: 'deterministic-rules',
        rule_matched: 'charge-carburant'
      };
    }

    // Électricité et eau : électricité/senelec/eau -> 6053
    if (/\b(electricite|senelec|eau|sde|sen eau)\b/.test(norm)) {
      return {
        matched: true,
        type: 'charge',
        montant,
        devise: 'FCFA',
        moyen,
        compte_debit: '6053',
        compte_credit: defaultTreasury,
        libelle: `Electricite et eau - ${montant} FCFA`,
        confiance,
        source: 'deterministic-rules',
        rule_matched: 'charge-electricite-eau'
      };
    }

    // Télécommunications : téléphone/recharge/internet/sms -> 626
    if (/\b(telephone|recharge|internet|sms|tel)\b/.test(norm)) {
      return {
        matched: true,
        type: 'charge',
        montant,
        devise: 'FCFA',
        moyen,
        compte_debit: '626',
        compte_credit: defaultTreasury,
        libelle: `Telecommunications - ${montant} FCFA`,
        confiance,
        source: 'deterministic-rules',
        rule_matched: 'charge-telecom'
      };
    }

    // Transports : transport/livraison -> 624
    if (/\b(transport|transports|livraison|livraisons)\b/.test(norm)) {
      return {
        matched: true,
        type: 'charge',
        montant,
        devise: 'FCFA',
        moyen,
        compte_debit: '624',
        compte_credit: defaultTreasury,
        libelle: `Transports - ${montant} FCFA`,
        confiance,
        source: 'deterministic-rules',
        rule_matched: 'charge-transport'
      };
    }

    // Si aucune règle n'a correspondu
    return { matched: false };
  }
}
