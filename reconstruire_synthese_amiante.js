#!/usr/bin/env node
/**
 * Reconstruit la synthèse amiante LICIEL à partir des exports XML/JSON.
 *
 * Entrées attendues dans le répertoire courant :
 * - Table_Z_Amiante.(xml|json)
 * - Table_Z_Amiante_prelevements.(xml|json) (optionnel)
 * - Table_General_Amiante_Analyses.(xml|json) (optionnel)
 * - Table_General_Photo.(xml|json) (optionnel)
 * - Table_Z_Amiante_doc_remis.(xml|json)
 * - Table_Z_Amiante_Ecart_Norme.(xml|json)
 * - Table_Z_Amiante_General.(xml|json)
 *
 * Sorties générées :
 * - synthese_amiante.json : structure complète Vue par pièce et Vue par ZPSO
 * - synthese_amiante.html : rendu HTML simplifié reprenant les vues
 */

const fs = require("node:fs");
const path = require("node:path");

const TABLE_FILES = {
  materiaux: { base: "Table_Z_Amiante", rowTag: "LiTable_Z_Amiante" },
  prelevements: { base: "Table_Z_Amiante_prelevements", rowTag: "LiTable_Z_Amiante_prelevements" },
  analyses: { base: "Table_General_Amiante_Analyses", rowTag: "LiTable_General_Amiante_Analyses" },
  photos: { base: "Table_General_Photo", rowTag: "LiTable_General_Photo" },
  documents: { base: "Table_Z_Amiante_doc_remis", rowTag: "LiTable_Z_Amiante_doc_remis" },
  ecarts: { base: "Table_Z_Amiante_Ecart_Norme", rowTag: "LiTable_Z_Amiante_Ecart_Norme" },
  general: { base: "Table_Z_Amiante_General", rowTag: "LiTable_Z_Amiante_General" }
};

function main() {
  const parsedTables = {};

  for (const [key, info] of Object.entries(TABLE_FILES)) {
    parsedTables[key] = lireTable(info.base, info.rowTag);
  }

  const synthese = construireSynthese(parsedTables);
  const sortieJson = path.join(process.cwd(), "synthese_amiante.json");
  const sortieHtml = path.join(process.cwd(), "synthese_amiante.html");

  fs.writeFileSync(sortieJson, JSON.stringify(synthese, null, 2), "utf8");
  fs.writeFileSync(sortieHtml, genererHtml(synthese), "utf8");

  console.log(`Synthèse générée :\n- ${sortieJson}\n- ${sortieHtml}`);
}

function lireTable(baseName, rowTag) {
  const jsonPath = `${baseName}.json`;
  const xmlPath = `${baseName}.xml`;

  if (fs.existsSync(jsonPath)) {
    try {
      const contenu = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      if (Array.isArray(contenu)) return contenu;
      if (Array.isArray(contenu.items)) return contenu.items;
      return [];
    } catch (err) {
      console.warn(`Lecture JSON impossible pour ${jsonPath}:`, err.message);
    }
  }

  if (fs.existsSync(xmlPath)) {
    try {
      const texte = fs.readFileSync(xmlPath, "utf8");
      return parserXmlBasique(texte, rowTag);
    } catch (err) {
      console.warn(`Lecture XML impossible pour ${xmlPath}:`, err.message);
    }
  }

  return [];
}

function parserXmlBasique(texte, rowTag) {
  if (!texte) return [];

  const lignes = [];
  const nettoye = texte.replace(/<\?xml[^>]*>/gi, "").replace(/<!DOCTYPE[^>]*>/gi, "");
  const rowRegex = rowTag
    ? new RegExp(`<${rowTag}[^>]*>([\\s\\S]*?)<\\/${rowTag}>`, "gi")
    : null;

  if (rowRegex) {
    let match;
    while ((match = rowRegex.exec(nettoye))) {
      const obj = extraireChamps(match[1]);
      if (Object.keys(obj).length) lignes.push(obj);
    }
  }

  if (!lignes.length) {
    const fallback = extraireChamps(nettoye);
    if (Object.keys(fallback).length) lignes.push(fallback);
  }

  return lignes;
}

function extraireChamps(segment) {
  const obj = {};
  const fieldRegex = /<([^>]+)>([\s\S]*?)<\/\1>/g;
  let match;
  while ((match = fieldRegex.exec(segment))) {
    const cle = match[1];
    obj[cle] = nettoyerTexte(match[2]);
  }
  return obj;
}

function nettoyerTexte(valeur) {
  return `${valeur || ""}`.replace(/\s+/g, " ").trim();
}

function construireSynthese(tables) {
  const materiaux = tables.materiaux || [];
  const prelevementsTable = tables.prelevements || [];
  const analysesTable = tables.analyses || [];
  const photosTable = tables.photos || [];

  const prelevementParClef = creerIndex(analysesTable, item => item.LiColonne_Clef_composant || item.Clef_composant);
  const photoParPrelevement = creerIndex(photosTable, item => item.LiColonne_Photo || item.Photo || item.LiColonne_LiColonne_Photo);

  const prelevementsEnrichis = creerIndex(prelevementsTable, item => item.LiColonne_Num_Prelevement || item.Num_Prelevement);

  const zpsos = materiaux.map((mat, index) => {
    const id = mat.LiColonne_Id_Prelevement || mat.Num_ZPSO || mat.Num_Materiau || `ZPSO-${index + 1}`;
    const desc = mat.LiColonne_Description || mat.materiau_produit || mat.Description || "";
    const localisationBrute = mat.LiColonne_Localisation || mat.Local_visite || "";
    const localisations = nettoyerLocalisations(localisationBrute);
    const resultat = mat.LiColonne_Resultats || mat.resultat || "";

    const prelevementsIds = (mat.LiColonne_num_prelevement || mat.num_prelevement || "")
      .split(";")
      .map(v => v.trim())
      .filter(Boolean);

    const detailsLoc = (mat.LiColonne_Detail_loc || localisationBrute || "")
      .split(";")
      .map(v => v.trim())
      .filter(Boolean);

    const prelevements = prelevementsIds.map((pid, idx) => {
      const enrichi = prelevementsEnrichis[pid] || {};
      const clef = enrichi.LiColonne_ClefComposant || enrichi.ClefComposant;
      const pvAnalyse = clef && prelevementParClef[clef] ?
        (prelevementParClef[clef].LiColonne_Repertoire_plan || prelevementParClef[clef].Repertoire_plan) :
        (enrichi.LiColonne_PV_Analyse_Lie || enrichi.PV_Analyse_Lie || "");

      return {
        id: pid,
        localisation: detailsLoc[idx] || enrichi.LiColonne_Localisation || enrichi.Localisation || localisationBrute,
        photo: photoParPrelevement[pid]?.LiColonne_Chemin_acces || photoParPrelevement[pid]?.Chemin_acces || "",
        pv: pvAnalyse,
        resultat: enrichi.LiColonne_Resultat_reperage || enrichi.Resultat_reperage || mat.LiColonne_Resultats || "",
        commentaire_labo: enrichi.LiColonne_Commentaires_Labo || enrichi.Commentaires_Labo || ""
      };
    });

    return {
      id,
      description: desc,
      resultat,
      localisations,
      prelevements
    };
  });

  const toutesPieces = Array.from(new Set(zpsos.flatMap(z => z.localisations)));

  const pieces = toutesPieces.map(piece => {
    const zpsosPourPiece = zpsos.filter(z => z.localisations.includes(piece));
    return {
      piece,
      resultat_global: determinerResultat(zpsosPourPiece.map(z => z.resultat)),
      zpsos: zpsosPourPiece
    };
  });

  const prelevementsUniques = new Set();
  zpsos.forEach(z => z.prelevements.forEach(p => prelevementsUniques.add(p.id)));

  const globalCounts = {
    presence_amiante: zpsos.some(z => estPresence(z.resultat)),
    nb_zones_total: zpsos.length,
    nb_zones_presence: zpsos.filter(z => estPresence(z.resultat)).length,
    nb_zones_absence: zpsos.filter(z => estAbsence(z.resultat)).length,
    nb_zones_suspect: zpsos.filter(z => estSuspect(z.resultat)).length,
    nb_prelevements_total: prelevementsUniques.size,
    nb_prelevements_presence: zpsos
      .flatMap(z => z.prelevements)
      .filter(p => estPresence(p.resultat))
      .length,
    nb_prelevements_absence: zpsos
      .flatMap(z => z.prelevements)
      .filter(p => estAbsence(p.resultat))
      .length
  };

  return {
    global: globalCounts,
    pieces,
    zpsos,
    documents: formaterDocuments(tables.documents || []),
    ecarts_norme: formaterEcarts(tables.ecarts || [])
  };
}

function creerIndex(collection = [], getter) {
  return collection.reduce((acc, item) => {
    const cle = getter(item);
    if (cle) acc[cle] = item;
    return acc;
  }, {});
}

function nettoyerLocalisations(texte) {
  if (!texte) return [];
  return texte
    .split(";")
    .map(t => t.trim())
    .filter(Boolean)
    .map(t => t.replace(/\s{2,}/g, " "));
}

function determinerResultat(resultats = []) {
  if (resultats.some(estPresence)) return "Présence d'amiante";
  if (resultats.some(estSuspect)) return "Matériau suspect";
  if (resultats.some(estAbsence)) return "Absence d'amiante";
  return "Non renseigné";
}

function estPresence(valeur = "") {
  const v = valeur.toLowerCase();
  return v.includes("présence") || v.includes("present") || v.includes("positif");
}

function estAbsence(valeur = "") {
  const v = valeur.toLowerCase();
  return v.includes("absence") || v.includes("absent") || v.includes("négatif") || v.includes("negatif");
}

function estSuspect(valeur = "") {
  const v = valeur.toLowerCase();
  return v.includes("suspect") || v.includes("susceptible") || v.includes("à confirmer") || v.includes("a confirmer");
}

function formaterDocuments(items) {
  const remis = items.map(i => i.LiColonne_Doc_Remis || i.Doc_Remis || i.Document || i.Libelle || "").filter(Boolean);
  const demandes = items.map(i => i.LiColonne_Doc_Demandes || i.Doc_Demandes || "").filter(Boolean);
  return { remis, demandes };
}

function formaterEcarts(items) {
  return items.map(i => ({
    observation: i.LiColonne_Observation || i.Observation || i.Libelle || "",
    oui: booleanise(i.LiColonne_Oui || i.Oui),
    non: booleanise(i.LiColonne_Non || i.Non),
    so: booleanise(i.LiColonne_SO || i.SO || i.SansObjet)
  }));
}

function booleanise(val) {
  if (val === undefined || val === null) return false;
  const v = `${val}`.trim().toLowerCase();
  return ["oui", "true", "1", "x"].includes(v);
}

function genererHtml(synthese) {
  const lignesPieces = synthese.pieces
    .map(piece => {
      const zpsosHtml = piece.zpsos
        .map(z => {
          const prels = z.prelevements
            .map(p => `<li><strong>${p.id}</strong> — ${p.localisation || ""}${p.photo ? ` — Photo : ${p.photo}` : ""}${p.pv ? ` — PV labo : ${p.pv}` : ""}</li>`)
            .join("");
          return `<li><strong>${z.id}</strong> — ${z.description} — ${z.resultat}<ul>${prels || "<li>Aucun prélèvement</li>"}</ul></li>`;
        })
        .join("");
      return `<section><h3>Pièce : ${piece.piece} (${piece.resultat_global})</h3><ul>${zpsosHtml}</ul></section>`;
    })
    .join("\n");

  const lignesZpsos = synthese.zpsos
    .map(z => {
      const prels = z.prelevements
        .map(p => `<li>${p.id} — ${p.localisation || ""}${p.photo ? ` — Photo : ${p.photo}` : ""}${p.pv ? ` — PV labo : ${p.pv}` : ""}</li>`)
        .join("");
      return `<section><h3>${z.id} — ${z.description} — ${z.resultat}</h3><p>Localisations : ${z.localisations.join("; ") || "Non précisées"}</p><ul>${prels || "<li>Aucun prélèvement</li>"}</ul></section>`;
    })
    .join("\n");

  const docs = synthese.documents || { remis: [], demandes: [] };
  const ecarts = (synthese.ecarts_norme || [])
    .map(e => `<li>${e.observation} — Oui: ${e.oui ? "X" : ""} / Non: ${e.non ? "X" : ""} / SO: ${e.so ? "X" : ""}</li>`)
    .join("");

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>Synthèse amiante</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 2rem; line-height: 1.5; }
    h1 { color: #0d47a1; }
    section { margin-bottom: 1.5rem; }
  </style>
</head>
<body>
  <h1>Synthèse amiante (reconstruite)</h1>
  <p><strong>Zones :</strong> ${synthese.global.nb_zones_total} | Présence : ${synthese.global.nb_zones_presence} | Absence : ${synthese.global.nb_zones_absence} | Suspect : ${synthese.global.nb_zones_suspect}</p>
  <p><strong>Prélèvements :</strong> ${synthese.global.nb_prelevements_total} | Présence : ${synthese.global.nb_prelevements_presence} | Absence : ${synthese.global.nb_prelevements_absence}</p>
  <h2>Vue par pièce</h2>
  ${lignesPieces}
  <h2>Vue par ZPSO</h2>
  ${lignesZpsos}
  <h2>Documents</h2>
  <p>Remis : ${docs.remis.join(", ") || "Aucun"}</p>
  <p>Demandés : ${docs.demandes.join(", ") || "Aucun"}</p>
  <h2>Écarts normatifs</h2>
  <ul>${ecarts}</ul>
</body>
</html>`;
}

if (require.main === module) {
  main();
}
