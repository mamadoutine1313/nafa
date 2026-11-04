import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { SYSCOHADA_ACCOUNTS } from './db.js';


dotenv.config();

/**
 * Liste blanche stricte des comptes SYSCOHADA autorisés (synchronisée avec le plan comptable officiel)
 * Test update
 */
export const ALLOWED_SYSCOHADA_ACCOUNTS = new Set(
  SYSCOHADA_ACCOUNTS.map(a => a.code)
);

/**
 * Types d'opérations autorisés selon SYSCOHADA
 */
export const ALLOWED_TRANSACTION_TYPES = new Set([
  'vente',
  'achat',
  'charge',
  'immobilisation',
  'tresorerie',
  'capital',
  'emprunt',
  'produit',
  'reglement_client',
  'avance_salaire'
]);

/**
 * Valide rigoureusement la réponse JSON de l'IA selon les règles SYSCOHADA
 * Ne JAMAIS faire confiance au modèle sans ces contrôles stricts.
 * 
 * @param {string|Object} rawResponse 
 * @returns {{ valid: boolean, data?: Object, error?: string }}
 */
export function validateAiResponse(rawResponse) {
  if (!rawResponse) {
    return { valid: false, error: 'Réponse vide' };
  }

  let parsed = rawResponse;
  if (typeof rawResponse === 'string') {
    try {
      // Extraire le premier bloc JSON valide même si le modèle a inclus du texte ou du markdown
      let text = rawResponse.trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        text = jsonMatch[0];
      }
      parsed = JSON.parse(text);
    } catch (err) {
      return { valid: false, error: `JSON invalide : ${err.message}` };
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, error: 'La réponse doit être un objet JSON' };
  }

  const { type, montant, moyen, compte_debit, compte_credit, libelle, confiance } = parsed;

  // 1. Validation du type
  const normalizedType = String(type || '').toLowerCase().trim();
  if (!ALLOWED_TRANSACTION_TYPES.has(normalizedType)) {
    return { 
      valid: false, 
      error: `Type comptable invalide : "${type}" (attendu : ${Array.from(ALLOWED_TRANSACTION_TYPES).join(', ')})` 
    };
  }

  // 2. Validation du montant (positif et fini)
  const numMontant = Number(montant);
  if (!Number.isFinite(numMontant) || numMontant <= 0) {
    return { valid: false, error: `Montant invalide : ${montant} (doit être un nombre positif et fini)` };
  }

  // 3. Validation de la présence des comptes dans la liste blanche
  const debitStr = String(compte_debit || '').trim();
  const creditStr = String(compte_credit || '').trim();

  if (!ALLOWED_SYSCOHADA_ACCOUNTS.has(debitStr)) {
    return { valid: false, error: `Compte de débit non autorisé ou inconnu : "${debitStr}"` };
  }

  if (!ALLOWED_SYSCOHADA_ACCOUNTS.has(creditStr)) {
    return { valid: false, error: `Compte de crédit non autorisé ou inconnu : "${creditStr}"` };
  }

  // 4. Débit != Crédit
  if (debitStr === creditStr) {
    return { valid: false, error: `Le compte de débit (${debitStr}) ne peut pas être identique au compte de crédit (${creditStr})` };
  }

  // 5. Confiance entre 0 et 1
  const numConfiance = Number(confiance);
  if (!Number.isFinite(numConfiance) || numConfiance < 0 || numConfiance > 1) {
    return { valid: false, error: `Confiance invalide : ${confiance} (doit être un flottant entre 0 et 1)` };
  }

  // 6. Moyen de paiement
  const safeMoyen = ['especes', 'virement', 'credit'].includes(moyen) ? moyen : 'especes';

  return {
    valid: true,
    data: {
      matched: true,
      type: normalizedType,
      montant: numMontant,
      devise: 'FCFA',
      moyen: safeMoyen,
      compte_debit: debitStr,
      compte_credit: creditStr,
      libelle: libelle || `${normalizedType.toUpperCase()} - ${numMontant} FCFA`,
      confiance: numConfiance,
      source: 'ai-fallback',
      rule_matched: parsed.rule_matched || 'llm-ai-fallback'
    }
  };
}

/**
 * Construit le prompt système expert SYSCOHADA pour le LLM
 * @returns {string}
 */
export function buildSyscohadaSystemPrompt() {
  const accountsFormatted = SYSCOHADA_ACCOUNTS.map(a => 
    `${a.code} : ${a.label} (${a.type})`
  ).join('\n');

  return `Tu es un expert-comptable agréé, spécialiste du Système Comptable OHADA (SYSCOHADA révisé) pour les TPE et PME d'Afrique de l'Ouest et Centrale.
L'entreprise est « Boutique Dakar SARL » au Sénégal (devise : FCFA, non assujettie à la TVA).
Analyse le message de l'entrepreneur (écrit en français familier, argot commercial ou expressions locales du Sénégal/OHADA) et traduis-le en écriture comptable rigoureuse en partie double (Débit / Crédit).

Réponds UNIQUEMENT par un objet JSON valide, sans texte d'introduction ni de conclusion :
{
  "type": "vente" | "achat" | "charge" | "immobilisation" | "tresorerie" | "capital" | "emprunt" | "produit" | "reglement_client" | "avance_salaire",
  "montant": <nombre positif en FCFA>,
  "moyen": "especes" | "virement" | "credit",
  "compte_debit": "<code compte>",
  "compte_credit": "<code compte>",
  "libelle": "<description courte de l'opération>",
  "confiance": <nombre entre 0.0 et 1.0>
}

LISTE BLANCHE DES COMPTES SYSCOHADA AUTORISÉS (SEULS CES CODES SONT VALIDES) :
${accountsFormatted}

GUIDE DES OPÉRATIONS FRÉQUENTES :
1. Ventes :
   - Vente de marchandises : Crédit 701, Débit Trésorerie (571/521) ou 411 si à crédit.
   - Prestations de services (couture, réparation, coiffure, conseil) : Crédit 706.
2. Achats :
   - Marchandises pour revente (stock, riz, pagnes, huile, pièces) : Débit 601, Crédit Trésorerie ou 401 si crédit fournisseur.
   - Fournitures de bureau consommables (papier, stylos, cahiers) : Débit 604.
3. Immobilisations & Matériel durable (Classe 2) :
   - Matériel informatique et mobilier (ordinateurs, smartphone boutique, imprimantes, étagères, bureaux) : Débit 244.
   - Matériel d'outillage & production (machine à coudre, congélateur, groupe électrogène, frigo, four) : Débit 241.
   - Matériel de transport (moto, scooter, tricycle, utilitaire) : Débit 245.
4. Trésorerie & Virements internes :
   - Retrait banque pour caisse : Débit 571, Crédit 521.
   - Dépôt espèces en banque ou transfert vers Wave/Orange Money : Débit 521, Crédit 571.
5. Charges externes courantes :
   - Frais de retrait / transfert Wave & Orange Money, agios bancaires : Débit 631.
   - Honoraires comptable, juriste, avocat, expert : Débit 622.
   - Primes d'assurance (boutique, véhicule, incendie) : Débit 625.
   - Publicité Facebook, Instagram, affiches, enseignes : Débit 627.
   - Gardiennage, vigile, sécurité, nettoyage : Débit 628.
   - Patente, taxes municipales, mairie, vignette : Débit 646.
   - Loyers boutique/magasin : Débit 613.
   - Entretien, réparations électricité/plomberie/moto : Débit 615.
   - Carburant moto/voiture : Débit 6051.
   - Électricité (Senelec) et eau (Sen'Eau) : Débit 6053.
   - Télécoms, crédit téléphone, internet, SMS : Débit 626.
   - Transport et livraison : Débit 624.
   - Salaires employés : Débit 641.
   - Intérêts d'emprunt bancaire : Débit 671.
6. Capitaux, Financements & Tiers :
   - Apport de capital personnel : Crédit 101, Débit Trésorerie.
   - Retrait/prélèvement personnel du patron/exploitant : Débit 104, Crédit Trésorerie.
   - Emprunt bancaire reçu : Débit 521, Crédit 162.
   - Remboursement emprunt bancaire : Débit 162, Crédit 521.
   - Avance/acompte sur salaire employé : Débit 422, Crédit Trésorerie.
   - Encaissement créance / dette client antérieure : Débit Trésorerie, Crédit 411.
   - Loyer perçu pour sous-location : Débit Trésorerie, Crédit 754.

RÈGLES IMPÉRATIVES :
- Débit DOIT être différent de Crédit.
- Montant strictly > 0.
- Si le message n'est pas une opération financière intelligible (ex: salutation, question hors sujet), renvoie {"montant": 0, "confiance": 0}.`;
}

/**
 * Appelle l'API Google Gemini
 * @param {string} message 
 * @param {string} apiKey 
 * @returns {Promise<string>}
 */
async function callGemini(message, apiKey) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const systemInstruction = buildSyscohadaSystemPrompt();

  const body = {
    system_instruction: {
      parts: [{ text: systemInstruction }]
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: `Analyse et traduis cette transaction : "${message}"` }]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      response_mime_type: 'application/json'
    }
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error [${res.status}]: ${errText}`);
    }

    const json = await res.json();
    return json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Appelle l'API Anthropic Claude
 * @param {string} message 
 * @param {string} apiKey 
 * @returns {Promise<string>}
 */
async function callClaude(message, apiKey) {
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
  const anthropic = new Anthropic({
    apiKey,
    timeout: 15000
  });

  const response = await anthropic.messages.create({
    model,
    max_tokens: 400,
    system: buildSyscohadaSystemPrompt(),
    messages: [
      {
        role: 'user',
        content: `Analyse et traduis cette transaction : "${message}"`
      }
    ]
  });

  return response.content?.[0]?.text || '';
}

/**
 * Appel de repli vers le LLM (Gemini ou Claude) lorsque les règles déterministes ne reconnaissent pas le message
 * @param {string} message 
 * @returns {Promise<Object>}
 */
export async function processWithAiFallback(message) {
  const geminiKey = process.env.GEMINI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if ((!geminiKey || !geminiKey.trim()) && (!anthropicKey || !anthropicKey.trim())) {
    return {
      matched: false,
      error: 'Traitement IA indisponible, message non reconnu'
    };
  }

  let rawContent = '';
  let providerUsed = '';

  try {
    // Si Gemini est configuré, on l'utilise en priorité (ou si Claude n'est pas fourni)
    if (geminiKey && geminiKey.trim()) {
      providerUsed = 'gemini';
      rawContent = await callGemini(message, geminiKey.trim());
    } else if (anthropicKey && anthropicKey.trim()) {
      providerUsed = 'claude';
      rawContent = await callClaude(message, anthropicKey.trim());
    }

    const validation = validateAiResponse(rawContent);

    if (!validation.valid) {
      console.warn(`Rejet de la réponse de l'IA (${providerUsed}) par les contrôles stricts de code :`, validation.error);
      return {
        matched: false,
        error: validation.error
      };
    }

    validation.data.source = `ai-fallback-${providerUsed}`;
    return validation.data;
  } catch (error) {
    console.error(`Erreur lors de l'appel LLM (${providerUsed}) :`, error.message);
    return {
      matched: false,
      error: 'Traitement IA indisponible, message non reconnu'
    };
  }
}
