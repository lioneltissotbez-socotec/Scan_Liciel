/**
 * Module Synthèse Amiante
 * Lecture d'un export Excel LICIEL et affichage interactif par ville, adresse et logement.
 */

let groupedData = {};

const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const generateBtn = document.getElementById("generateBtn");
const autoXmlStatus = document.getElementById("autoXmlStatus");
const jsonModal = document.getElementById("jsonModal");
const jsonModalBody = document.getElementById("jsonModalBody");
const jsonModalTitle = document.getElementById("jsonModalTitle");
const closeJsonModal = document.getElementById("closeJsonModal");
const jsonDebugButtons = document.querySelectorAll("[data-json-path]");

jsonDebugButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const path = btn.getAttribute("data-json-path");
    const label = btn.getAttribute("data-json-label") || path;
    afficherJsonDansModal(path, label);
  });
});

if (closeJsonModal) closeJsonModal.addEventListener("click", fermerJsonModal);
if (jsonModal?.querySelector) {
  const backdrop = jsonModal.querySelector(".json-modal__backdrop");
  if (backdrop) backdrop.addEventListener("click", fermerJsonModal);
}

window.addEventListener("keydown", e => {
  if (e.key === "Escape") fermerJsonModal();
});

if (dropZone) {
  dropZone.addEventListener("dragover", e => {
    e.preventDefault();
    dropZone.classList.add("amiante-dropzone--hover");
  });

  dropZone.addEventListener("dragleave", e => {
    e.preventDefault();
    dropZone.classList.remove("amiante-dropzone--hover");
  });

  dropZone.addEventListener("drop", e => {
    e.preventDefault();
    dropZone.classList.remove("amiante-dropzone--hover");
    const files = e.dataTransfer.files;
    if (files.length) {
      fileInput.files = files;
      generateBtn.click();
    }
  });
}

if (generateBtn) {
  generateBtn.addEventListener("click", () => {
    if (!fileInput.files.length) {
      alert("Merci de sélectionner un fichier Excel .xlsx.");
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      const workbook = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      processDataAndSetupNavigation(data);
    };
    reader.readAsArrayBuffer(fileInput.files[0]);
  });
}

async function afficherJsonDansModal(path, label = "Fichier JSON") {
  if (!jsonModal || !jsonModalBody) {
    alert(`Impossible d'afficher ${label} : fenêtre modale absente.`);
    return;
  }

  jsonModal.style.display = "grid";
  document.body.style.overflow = "hidden";
  jsonModalBody.textContent = "Chargement...";
  if (jsonModalTitle) jsonModalTitle.textContent = label;

  try {
    const response = await fetch(path, { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`Fichier introuvable ou illisible (code ${response.status}).`);
    }

    const rawText = await response.text();
    jsonModalBody.textContent = formaterJsonLisible(rawText);
  } catch (err) {
    console.error(`Lecture impossible pour ${label}`, err);
    jsonModalBody.textContent = `Impossible de lire ${label}.\n${err.message}`;
  }
}

function fermerJsonModal() {
  if (!jsonModal) return;
  jsonModal.style.display = "none";
  document.body.style.overflow = "";
}

function formaterJsonLisible(text = "") {
  const trimmed = text.trim();
  if (!trimmed) return "(fichier vide)";
  try {
    const parsed = JSON.parse(trimmed);
    return JSON.stringify(parsed, null, 2);
  } catch (err) {
    return text;
  }
}

async function chargerSyntheseAutomatique() {
  const payload = lirePayloadAutomatique();
  if (payload) {
    appliquerPayloadAutomatique(payload);
    return;
  }

  const jsonLocal = await chargerDepuisJsonLocal();
  if (jsonLocal) {
    appliquerPayloadAutomatique(jsonLocal);
    return;
  }

  await chargerSyntheseDepuisXmlLocal();
}

function appliquerPayloadAutomatique(payload) {
  try {
    const rows = payload?.rows || [];
    if (!rows.length) {
      if (autoXmlStatus) autoXmlStatus.textContent = "Aucune donnée amiante reçue.";
      return;
    }

    processDataAndSetupNavigation(rows);
    if (autoXmlStatus) {
      const label = payload?.meta?.label || payload?.meta?.id || "mission";
      autoXmlStatus.textContent = `Synthèse amiante chargée automatiquement pour ${label}.`;
    }
  } catch (err) {
    console.error("Impossible de charger la synthèse amiante automatique", err);
    if (autoXmlStatus) autoXmlStatus.textContent = "Lecture automatique impossible. Relancez depuis le module administratif.";
  }
}

chargerSyntheseAutomatique();

window.addEventListener("storage", e => {
  if (e.key !== "amianteAutoRows" || !e.newValue) return;

  try {
    const payload = JSON.parse(e.newValue);
    appliquerPayloadAutomatique(payload);
  } catch (err) {
    console.error("Impossible de rafraîchir la synthèse amiante depuis le stockage", err);
  }
});

function lirePayloadAutomatique() {
  const key = "amianteAutoRows";
  const EXPIRATION_MS = 10 * 60 * 1000; // 10 minutes

  const rawSession = sessionStorage.getItem(key);
  const rawLocal = !rawSession ? localStorage.getItem(key) : null;

  if (!rawSession && !rawLocal) {
    if (autoXmlStatus) {
      autoXmlStatus.textContent = "En attente des données XML transmises par le module administratif.";
    }
    return null;
  }

  const raw = rawSession || rawLocal;

  try {
    const payload = JSON.parse(raw);
    const createdAt = payload?.meta?.createdAt ? Number(payload.meta.createdAt) : null;
    const age = createdAt ? Date.now() - createdAt : 0;

    sessionStorage.removeItem(key);
    localStorage.removeItem(key);

    if (createdAt && age > EXPIRATION_MS) {
      if (autoXmlStatus) autoXmlStatus.textContent = "Données automatiques expirées. Relancez depuis le module administratif.";
      return null;
    }

    return payload;
  } catch (err) {
    console.error("Impossible de lire le relais automatique amiante", err);
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
    if (autoXmlStatus) autoXmlStatus.textContent = "Lecture automatique impossible. Relancez depuis le module administratif.";
    return null;
  }
}

async function chargerSyntheseDepuisXmlLocal() {
  const fichiers = [
    { name: "Table_Z_Amiante.xml", key: "materiaux" },
    { name: "Table_Z_Amiante_prelevements.xml", key: "prelevements" },
    { name: "Table_General_Amiante_Analyses.xml", key: "prelevements" },
    { name: "Table_Z_Amiante_doc_remis.xml", key: "documents" },
    { name: "Table_Z_Amiante_Ecart_Norme.xml", key: "ecarts" },
    { name: "Table_Z_Amiante_General.xml", key: "general" }
  ];

  const parsed = { materiaux: [], prelevements: [], documents: [], ecarts: [], general: [] };
  const parser = new DOMParser();
  let fichiersTrouves = 0;

  for (const fichier of fichiers) {
    try {
      const response = await fetch(fichier.name);
      if (!response.ok) continue;
      const text = await response.text();
      const doc = parser.parseFromString(text, "application/xml");
      const rows = extraireLignesXml(doc, text, fichier.name);
      parsed[fichier.key] = (parsed[fichier.key] || []).concat(rows);
      fichiersTrouves++;
    } catch (err) {
      console.warn(`Impossible de lire ${fichier.name}`, err);
    }
  }

  if (!fichiersTrouves || !parsed.materiaux.length) {
    if (autoXmlStatus) {
      autoXmlStatus.textContent = "Aucun XML amiante détecté à la racine du projet.";
    }
    return;
  }

  try {
    const synthese = construireSyntheseDepuisXml(parsed);
    const generalInfo = synthese.sourceGeneral || parsed.general[0] || {};
    const rows = convertirSyntheseEnRows(synthese, generalInfo);

    if (!rows.length) {
      if (autoXmlStatus) autoXmlStatus.textContent = "XML amiante détectés mais aucune donnée exploitable.";
      return;
    }

    processDataAndSetupNavigation(rows);
    if (autoXmlStatus) autoXmlStatus.textContent = "Synthèse amiante générée depuis les XML présents localement.";

    const payload = { rows, meta: { id: generalInfo.LiColonne_Gen_Num_rapport || "mission", createdAt: Date.now(), source: "local-xml" } };
    sessionStorage.setItem("amianteAutoRows", JSON.stringify(payload));
  } catch (err) {
    console.error("Impossible de générer la synthèse amiante à partir des XML locaux", err);
    if (autoXmlStatus) autoXmlStatus.textContent = "Impossible de générer la synthèse amiante à partir des XML locaux.";
  }
}

async function chargerDepuisJsonLocal() {
  try {
    const response = await fetch("amiante_auto.json");
    if (!response.ok) return null;

    const payload = await response.json();
    if (!payload || !Array.isArray(payload.rows) || !payload.rows.length) return null;

    const meta = payload.meta || {};
    const label = meta.label || meta.id || meta.generatedFrom || "mission";
    const createdAt = meta.createdAt || Date.now();
    return { rows: payload.rows, meta: { ...meta, label, createdAt } };
  } catch (err) {
    console.warn("Impossible de charger amiante_auto.json", err);
    return null;
  }
}

function nettoyerNomPiece(nom) {
  if (!nom) return "Non précisé";
  return nom.split(";").map(seg => {
    seg = seg.trim();
    const idx = Math.max(seg.lastIndexOf(" - "), seg.lastIndexOf("-"));
    return idx !== -1 ? seg.slice(idx + (seg[idx] === " " ? 3 : 1)).trim() : seg;
  }).filter(Boolean).join("; ");
}

function compterEtats(rows) {
  const counts = { pos: 0, neg: 0, suspect: 0, nonTeste: 0 };
  rows.forEach(r => {
    const v = (r.resultat || "").toLowerCase();
    if (v.includes("présence") || v.includes("positif")) counts.pos++;
    else if (v.includes("absence") || v.includes("négatif")) counts.neg++;
    else if (v.includes("suspect") || v.includes("susceptible") || v.includes("à confirmer")) counts.suspect++;
    else counts.nonTeste++;
  });
  return counts;
}

function determinerEtatGroupe(rows) {
  const counts = compterEtats(rows);
  if (counts.pos > 0) return "present";
  if (counts.suspect > 0) return "suspect";
  return "absent";
}

function determinerEtatGlobal(rows) {
  const counts = compterEtats(rows);
  let texte = "🟨 Investigation à prévoir";
  if (counts.pos > 0 && counts.suspect === 0) texte = "🟥 Présence d’amiante";
  else if (counts.neg > 0 && counts.pos === 0 && counts.suspect === 0) texte = "🟩 Absence d’amiante";
  else if (counts.pos > 0 && counts.suspect > 0) texte = "🟥 Présence d’amiante + 🟨 Investigation";
  else if (counts.neg > 0 && counts.suspect > 0 && counts.pos === 0) texte = "🟩 Absence d’amiante + 🟨 Investigation";
  return { texte, counts };
}

function processDataAndSetupNavigation(data) {
  groupedData = {};

  data.forEach(row => {
    const ville = row.Commune || "Ville non précisée";
    const adresse = row.Nom_EI || "Adresse non précisée";
    const logement = row.Num_UG || "UG non précisée";

    if (!groupedData[ville]) groupedData[ville] = { rows: [], addresses: {} };
    groupedData[ville].rows.push(row);

    if (!groupedData[ville].addresses[adresse]) groupedData[ville].addresses[adresse] = { rows: [], logements: {} };
    groupedData[ville].addresses[adresse].rows.push(row);

    if (!groupedData[ville].addresses[adresse].logements[logement]) groupedData[ville].addresses[adresse].logements[logement] = [];
    groupedData[ville].addresses[adresse].logements[logement].push(row);
  });

  document.getElementById("resultContainer").innerHTML = "";
  document.getElementById("addressSelection").style.display = "none";
  document.getElementById("logementSelection").style.display = "none";

  displayCityButtons();
}

function displayCityButtons() {
  const container = document.getElementById("citySelection");
  container.innerHTML = "<h3>🏙️ Choisissez une ville :</h3>";
  container.style.display = "block";

  Object.keys(groupedData).forEach(ville => {
    const allCityRows = groupedData[ville].rows;
    const numAddresses = Object.keys(groupedData[ville].addresses).length;
    const etatClass = determinerEtatGroupe(allCityRows);

    const button = document.createElement("button");
    button.className = "nav-btn";
    button.innerHTML = `<span class="status-pill ${etatClass}"></span>${ville} (${numAddresses})`;
    button.onclick = () => {
      container.querySelectorAll("button").forEach(btn => btn.classList.remove("active"));
      button.classList.add("active");
      displayAddressButtons(ville);
    };
    container.appendChild(button);
  });
}

function displayAddressButtons(ville) {
  const container = document.getElementById("addressSelection");
  container.innerHTML = `<h3>📍 Adresses à ${ville} :</h3>`;
  container.style.display = "block";

  document.getElementById("logementSelection").innerHTML = "";
  document.getElementById("logementSelection").style.display = "none";
  document.getElementById("resultContainer").innerHTML = "";

  const addresses = groupedData[ville].addresses;
  Object.keys(addresses).forEach(adresse => {
    const allAddressRows = addresses[adresse].rows;
    const numLogements = Object.keys(addresses[adresse].logements).length;
    const etatClass = determinerEtatGroupe(allAddressRows);

    const button = document.createElement("button");
    button.className = "nav-btn";
    button.innerHTML = `<span class="status-pill ${etatClass}"></span>${adresse} (${numLogements})`;
    button.onclick = () => {
      container.querySelectorAll("button").forEach(btn => btn.classList.remove("active"));
      button.classList.add("active");
      displayLogementButtons(ville, adresse);
    };
    container.appendChild(button);
  });
}

function displayLogementButtons(ville, adresse) {
  const container = document.getElementById("logementSelection");
  container.innerHTML = `<h3>🏠 Logements pour ${adresse} (${ville}) :</h3>`;
  container.style.display = "block";

  document.getElementById("resultContainer").innerHTML = "";

  const logements = groupedData[ville].addresses[adresse].logements;
  Object.keys(logements).forEach(logementKey => {
    const allLogementRows = logements[logementKey];
    const numComposants = allLogementRows.length;
    const etatClass = determinerEtatGroupe(allLogementRows);

    const button = document.createElement("button");
    button.className = "nav-btn";
    button.innerHTML = `<span class="status-pill ${etatClass}"></span>${logementKey} (${numComposants} composants)`;
    button.onclick = () => {
      container.querySelectorAll("button").forEach(btn => btn.classList.remove("active"));
      button.classList.add("active");
      generateHTML(allLogementRows);
    };
    container.appendChild(button);
  });
}

function generateHTML(data) {
  const container = document.getElementById("resultContainer");
  container.innerHTML = "";

  const nom = data[0].Nom_EI || "Adresse non précisée";
  const numUG = data[0].Num_UG || "Non précisé";
  const rows = data;

  const commune = rows[0].Commune || "";
  const date = rows[0].date_realisation || "";
  const operateur = rows[0].operateur || "";
  const rapport = rows[0].reference_rapport || "";
  const etage = rows[0].Etage || "Non précisé";

  const etatGlobal = determinerEtatGlobal(rows);
  const zones = [...new Set(rows.map(r => nettoyerNomPiece(r.applicabilite_ZPSO)).filter(Boolean))];
  const prelevements = [...new Set(rows.map(r => r.num_prelevement).filter(p => p && p.trim() !== ""))];
  const rowsAvecPrel = rows.filter(r => r.num_prelevement && r.num_prelevement.trim() !== "");
  const countsPrel = compterEtats(rowsAvecPrel);

  const logementDiv = document.createElement("div");
  logementDiv.className = "logement";
  logementDiv.innerHTML = `
    <div class="logement__header">
      <div>
        <h2>🏠 Logement ${numUG} – ${nom} (${commune})</h2>
        <p class="muted">📅 Diagnostiqué le <strong>${date}</strong> par <strong>${operateur}</strong> · 📄 Rapport : <strong>${rapport}</strong> · 🧱 Étage : <strong>${etage}</strong></p>
      </div>
      <div class="logement__badge">${etatGlobal.texte}</div>
    </div>
    <div class="infos">
      <div class="info-chip">Nombre de zones : <strong>${zones.length}</strong></div>
      <div class="compteurs">
        🟥 Présence : ${etatGlobal.counts.pos} |
        🟩 Absence : ${etatGlobal.counts.neg} |
        🟨 Suspect : ${etatGlobal.counts.suspect}
      </div>
      <div class="info-chip">Nombre de prélèvements : <strong>${prelevements.length}</strong></div>
      <div class="compteurs">
        🟥 Présence : ${countsPrel.pos} |
        🟩 Absence : ${countsPrel.neg}
      </div>
    </div>
  `;

  const tabs = document.createElement("div");
  tabs.className = "tabs-local";
  const btnPiece = document.createElement("button");
  const btnZPSO = document.createElement("button");
  btnPiece.textContent = "Vue par pièce";
  btnZPSO.textContent = "Vue par ZPSO";
  btnPiece.className = "tab-btn active";
  btnZPSO.className = "tab-btn";
  tabs.appendChild(btnPiece);
  tabs.appendChild(btnZPSO);
  logementDiv.appendChild(tabs);

  const contentDiv = document.createElement("div");
  logementDiv.appendChild(contentDiv);

  const groupedByPiece = {}, orderPieces = [];
  rows.forEach(r => {
    const cleaned = nettoyerNomPiece(r.Local_visite || "Non précisé").split(";").map(s => s.trim()).filter(Boolean);
    cleaned.forEach(piece => {
      if (!groupedByPiece[piece]) { groupedByPiece[piece] = []; orderPieces.push(piece); }
      groupedByPiece[piece].push(r);
    });
  });

  const renderVuePiece = () => {
    contentDiv.innerHTML = "";
    orderPieces.forEach(piece => {
      const composants = groupedByPiece[piece];
      const details = document.createElement("details");
      const results = composants.map(c => (c.resultat || "").toLowerCase());
      let icon = "⚪", etatClass = "non_teste";
      if (results.some(r => r.includes("présence"))) { icon = "🟥"; etatClass = "present"; }
      else if (results.some(r => r.includes("suspect"))) { icon = "🟨"; etatClass = "suspect"; }
      else if (results.every(r => r.includes("absence"))) { icon = "🟩"; etatClass = "absent"; }
      const summary = document.createElement("summary");
      summary.innerHTML = `${icon} Pièce : ${piece} <span class="resultat ${etatClass}" style="margin-left:8px;">${etatClass}</span>`;
      const ul = document.createElement("ul");
      composants.forEach(c => {
        const res = c.resultat || "";
        const resClass = res.toLowerCase().includes("présence") ? "present" :
          res.toLowerCase().includes("absence") ? "absent" :
          res.toLowerCase().includes("suspect") ? "suspect" : "non_teste";
        const li = document.createElement("li");
        li.innerHTML = `- ${c.materiau_produit}
          <span class="resultat ${resClass}">${res}</span>
          <ul class="niveau3"><li>• ZPSO : ${c.applicabilite_ZPSO || "Non précisé"}
          <ul class="niveau4"><li>◦ Prélèvements : ${c.num_prelevement || "Aucun"}</li></ul></li></ul>`;
        ul.appendChild(li);
      });
      details.appendChild(summary);
      details.appendChild(ul);
      contentDiv.appendChild(details);
    });
  };

  const groupedByZPSO = {}, orderZPSO = [];
  rows.forEach(r => {
    const cleaned = nettoyerNomPiece(r.applicabilite_ZPSO || "Non précisé").split(";").map(s => s.trim()).filter(Boolean);
    cleaned.forEach(z => { if (!groupedByZPSO[z]) { groupedByZPSO[z] = []; orderZPSO.push(z); } groupedByZPSO[z].push(r); });
  });

  const renderVueZPSO = () => {
    contentDiv.innerHTML = "";
    orderZPSO.forEach(zpso => {
      const composants = groupedByZPSO[zpso];
      const etats = composants.map(c => {
        const v = (c.resultat || "").toLowerCase();
        if (v.includes("présence")) return "present";
        if (v.includes("absence")) return "absent";
        if (v.includes("suspect")) return "suspect";
        return "non_teste";
      });
      const uniqueEtats = [...new Set(etats)];
      const pastilles = uniqueEtats.map(e => `<span class="resultat ${e}">${e}</span>`).join(" ");
      const composantNom = composants[0].materiau_produit || "Non précisé";
      const summary = document.createElement("summary");
      summary.innerHTML = `▪ ZPSO : ${zpso} — ${composantNom} ${pastilles}`;
      const ul = document.createElement("ul");
      composants.forEach(c => {
        const res = c.resultat || "";
        const resClass = res.toLowerCase().includes("présence") ? "present" :
          res.toLowerCase().includes("absence") ? "absent" :
          res.toLowerCase().includes("suspect") ? "suspect" : "non_teste";
        const li = document.createElement("li");
        li.innerHTML = `- ${c.materiau_produit} (${nettoyerNomPiece(c.Local_visite)})
          <span class="resultat ${resClass}">${res}</span>
          <ul class="niveau3"><li>• Prélèvements : ${c.num_prelevement || "Aucun"}</li></ul>`;
        ul.appendChild(li);
      });
      const details = document.createElement("details");
      details.appendChild(summary);
      details.appendChild(ul);
      contentDiv.appendChild(details);
    });
  };

  btnPiece.onclick = () => { btnPiece.classList.add("active"); btnZPSO.classList.remove("active"); renderVuePiece(); };
  btnZPSO.onclick = () => { btnZPSO.classList.add("active"); btnPiece.classList.remove("active"); renderVueZPSO(); };

  renderVuePiece();
  container.appendChild(logementDiv);
}

async function lireFichiersXml(files) {
  const parser = new DOMParser();
  const contents = await Promise.all(files.map(file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve({ name: file.name, text: e.target.result, doc: parser.parseFromString(e.target.result, "application/xml") });
    reader.onerror = reject;
    reader.readAsText(file);
  })));

  const result = { materiaux: [], prelevements: [], documents: [], ecarts: [], general: [] };

  contents.forEach(({ name, doc, text }) => {
    const lower = name.toLowerCase();
    const rows = extraireLignesXml(doc, text, name);
    if (lower.includes("table_z_amiante_prelevements")) result.prelevements = rows;
    else if (lower.includes("table_z_amiante_doc_remis")) result.documents = rows;
    else if (lower.includes("table_z_amiante_ecart_norme")) result.ecarts = rows;
    else if (lower.includes("table_z_amiante_general")) result.general = rows;
    else if (lower.includes("table_z_amiante")) result.materiaux = rows;
  });

  return result;
}

function extraireLignesXml(doc, rawText = "", fichierName = "") {
  const root = doc.documentElement;
  const parserErreur = root?.querySelector && root.querySelector("parsererror");
  if (parserErreur) return extraireLignesDepuisTexte(rawText, fichierName);

  const children = Array.from(root.children || []).filter(el => el.nodeType === 1);
  if (!children.length) {
    const obj = transformerElementEnObjet(root);
    if (Object.keys(obj).length <= 1) return extraireLignesDepuisTexte(rawText, fichierName);
    return [obj];
  }

  const lignes = children.map(el => transformerElementEnObjet(el));
  if (!lignes.length) return extraireLignesDepuisTexte(rawText, fichierName);
  return lignes;
}

function extraireLignesDepuisTexte(rawText = "", fichierName = "") {
  const text = `${rawText}`;

  const parseItems = (itemTag) => {
    const pattern = new RegExp(`<${itemTag}>([\\s\\S]*?)</${itemTag}>`, "gi");
    const items = [];
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const rawItem = match[1];
      const obj = {};
      const reg = /<([^\/>]+)>([\s\S]*?)<\/\1>/g;
      let sub;
      while ((sub = reg.exec(rawItem)) !== null) {
        const key = sub[1].trim();
        obj[key] = nettoyerTexteXml(sub[2]);
        if (key.startsWith("LiColonne_")) obj[key.replace("LiColonne_", "")] = obj[key];
      }
      items.push(obj);
    }
    return items;
  };

  if (/liitem_table_z_amiante_prelevements/i.test(text)) {
    const items = parseItems("LiItem_table_Z_Amiante_prelevements");
    return items.map(item => ({
      ...item,
      Num_Materiau: item.Num_Materiau || item.Reperage_3,
      Resultat_reperage: item.Resultat_reperage || item.Resultats,
      num_prelevement: item.Num_Prelevement || item.num_prelevement
    }));
  }

  if (/liitem_table_z_amiante/i.test(text)) {
    const items = parseItems("LiItem_table_Z_Amiante");
    return items.map(item => ({
      ...item,
      Local_visite: item.Local_visite || item.Localisation || item.Detail_loc,
      Ouvrage: item.Ouvrage || item.Ouvrages,
      Partie: item.Partie || item.Partie_Inspectee,
      materiau_produit: item.materiau_produit || item.Description || item.Partie_Inspectee,
      resultat: item.resultat || item.Resultats,
      num_prelevement: item.num_prelevement || item.Num_Prelevement,
      Num_Materiau: item.Num_Materiau || item.Reperage_3 || item.Id_Prelevement_Int_txt,
      Num_ZPSO: item.Num_ZPSO || item.Id_Prelevement,
      Dossier_Materiau: item.Dossier_Materiau || item.LiColonne_Dossier_Materiau
    }));
  }

  const colonneMatches = [...text.matchAll(/<LiColonne_([^>]+)>([\s\S]*?)<\/LiColonne_\1>/g)];
  if (colonneMatches.length) {
    const obj = {};
    colonneMatches.forEach(([, key, val]) => {
      obj[`LiColonne_${key}`] = nettoyerTexteXml(val);
    });
    return [obj];
  }

  if (!text.trim()) return [];
  console.warn(`XML brut non reconnu pour ${fichierName}`);
  return [];
}

function nettoyerTexteXml(valeur = "") {
  return `${valeur}`.replace(/\s+/g, " ").trim();
}

function transformerElementEnObjet(element, prefix = "") {
  const obj = {};
  const keyPrefix = prefix ? `${prefix}.` : "";

  if (element.attributes) {
    Array.from(element.attributes).forEach(attr => {
      obj[`${keyPrefix}${attr.name}`] = attr.value.trim();
    });
  }

  const childElements = Array.from(element.children).filter(el => el.nodeType === 1);
  if (!childElements.length) {
    obj[keyPrefix + element.tagName] = (element.textContent || "").trim();
    return obj;
  }

  childElements.forEach(child => {
    const childObj = transformerElementEnObjet(child, keyPrefix + child.tagName);
    Object.entries(childObj).forEach(([k, v]) => {
      obj[k] = v;
    });
  });

  return obj;
}

function construireSyntheseDepuisXml(parsed) {
  const generalInfo = parsed.general[0] || {};
  const ecarts = parsed.ecarts || [];
  const documents = parsed.documents || [];
  const prelevements = parsed.prelevements || [];
  const materiaux = parsed.materiaux || [];

  const generalWithFallback = Object.keys(generalInfo).length ? generalInfo : (() => {
    const dossier = materiaux[0]?.Dossier_Materiau || materiaux[0]?.LiColonne_Dossier_Materiau || "";
    return dossier ? { LiColonne_Gen_Num_rapport: dossier } : {};
  })();

  const labNom = generalWithFallback.Labo_nom || generalWithFallback.nom_labo || generalWithFallback.Nom_labo || generalWithFallback.Labo || "";
  const labAdresse = generalWithFallback.Labo_adresse || generalWithFallback.adresse_labo || generalWithFallback.Adresse_labo || generalWithFallback.Adresse || "";
  const labVille = generalWithFallback.Labo_ville || generalWithFallback.ville_labo || generalWithFallback.Ville_labo || "";
  const labCofrac = generalWithFallback.Labo_cofrac || generalWithFallback.cofrac || generalWithFallback.COFRAC || "";

  const synthese = {
    general: {
      nb_prelevements: Number(generalWithFallback.nb_prelevements || generalWithFallback.Nb_prelevements || generalWithFallback.Nombre_prelevements || generalWithFallback.LiColonne_Nb_Prelevement || 0),
      prefix_P: generalWithFallback.prefix_P || generalWithFallback.Prefix_P || generalWithFallback.LiColonne_Prelevement_Perfixe || "P",
      prefix_ZPSO: generalWithFallback.prefix_ZPSO || generalWithFallback.Prefix_ZPSO || generalWithFallback.LiColonne_Materiaux_Perfixe || generalWithFallback.LiColonne_ZPSO_Perfixe || "ZPSO-",
      description_travaux: generalWithFallback.description_travaux || generalWithFallback.Description_travaux || generalWithFallback.LiColonne_Description_travaux || "",
      labo: {
        nom: labNom,
        cofrac: labCofrac,
        adresse: labAdresse,
        ville: labVille
      }
    },
    documents: documents.map(doc => ({
      type: doc.Document || doc.Type || doc.Nom || doc.Libelle || "",
      remis: doc.Remis || doc.remis || doc.Statut || ""
    })),
    ecarts_norme: ecarts.map(item => ({
      observation: item.Observation || item.observation || item.Nom || item.Libelle || "",
      oui: normaliserBooleen(item.Oui || item.oui),
      non: normaliserBooleen(item.Non || item.non),
      so: normaliserBooleen(item.SO || item.so || item.SansObjet)
    })),
    materiaux: materiaux.map(mat => {
      const numMat = mat.Num_Materiau || mat.Num_materiau || mat.num_materiau || mat.NumMateriau || mat.Num_Mat;
      const zspo = mat.ZPSO || mat.applicabilite_ZPSO || mat.Applicabilite_ZPSO || mat.applicabilite_zspo || mat.Num_ZPSO;
      const prelevementsAssocies = prelevements
        .filter(p => {
          const pMat = p.Num_Materiau || p.Num_materiau || p.NumMat || p.Num_mate;
          return numMat && pMat && `${pMat}`.trim() === `${numMat}`.trim();
        })
        .map(p => {
          const resLabo = p.Resultat_reperage || p.resultat_reperage || p.Conclusion || p.Resultat || p["API_Labo_DATA_XML.conclusion_text"] || p.conclusion_text || "";
          const commentaireLabo = p.Commentaires || p.commentaire || p["API_Labo_DATA_XML.commentaire"] || "";
          return {
            id: p.Num_Prelevement || p.num_prelevement || p.Id || "",
            resultat: resLabo,
            commentaires_labo: commentaireLabo,
            pv: p.PV || p.pv || p.Justificatif || ""
          };
        });

      return {
        localisation: mat.Local_visite || mat.Localisation || mat.Zone || "",
        ouvrage: mat.Ouvrage || mat.Ouvrage_porteur || mat.Ouvrage_support || "",
        partie: mat.Partie || mat.Partie_inspectee || mat.Partie_observee || "",
        description: mat.materiau_produit || mat.Materiau || mat.Description || "",
        zspo: zspo || (numMat ? `${(generalInfo.prefix_ZPSO || generalInfo.Prefix_ZPSO || "ZPSO-")}${numMat}` : ""),
        resultat: mat.resultat || mat.Resultat || mat.Resultat_reperage || "",
        justification: mat.Justification || mat.Mode_operatoire || mat.Mode || "",
        prelevements: prelevementsAssocies,
        commentaires: mat.commentaires || mat.Commentaire || "",
        photos: mat.photos || mat.Photo || mat.PJ || ""
      };
    })
  };

  return { ...synthese, sourceGeneral: generalWithFallback };
}

function convertirSyntheseEnRows(synthese, generalInfo = {}) {
  const commune = generalInfo.LiColonne_Immeuble_Commune || "";
  const adresse = generalInfo.LiColonne_Immeuble_Adresse1 || generalInfo.LiColonne_Immeuble_Batiment || generalInfo.LiColonne_Immeuble_Nom || "";
  const missionId = generalInfo.LiColonne_Gen_Num_rapport
    || generalInfo.LiColonne_Gen_Num_mission
    || generalInfo.LiColonne_Gen_Num_dossier
    || generalInfo.LiColonne_Dossier_Materiau;
  const numUG = missionId
    || generalInfo.LiColonne_Loc_Lot
    || generalInfo.LiColonne_Immeuble_Lot
    || generalInfo.LiColonne_Immeuble_Loc_copro
    || generalInfo.LiColonne_Loc_Numero
    || "UG";
  const date = generalInfo.LiColonne_Gen_Date_rapport || generalInfo.LiColonne_Gen_Date || generalInfo.LiColonne_Gen_Date_mission || "";
  const operateur = generalInfo.LiColonne_Gen_Nom_operateur || generalInfo.LiColonne_Gen_Operateur || "";
  const rapport = generalInfo.LiColonne_Gen_Num_rapport || generalInfo.LiColonne_Gen_Numero_rapport || "";
  const etage = generalInfo.LiColonne_Loc_Etage || generalInfo.LiColonne_Immeuble_Etage || "";

  return (synthese.materiaux || []).map(mat => {
    const prelevementIds = (mat.prelevements || []).map(p => p.id).filter(Boolean).join(", ");
    const resultat = mat.resultat || (mat.prelevements && mat.prelevements[0] ? mat.prelevements[0].resultat : "");
    const nomEI = mat.localisation || adresse || "Adresse non précisée";
    const produit = mat.description || `${mat.ouvrage || ""} ${mat.partie || ""}`.trim();
    const numUgFinal = numUG || "UG";

    return {
      Nom_EI: nomEI,
      Num_UG: numUgFinal,
      Commune: commune,
      date_realisation: date,
      operateur,
      reference_rapport: rapport,
      Etage: etage,
      applicabilite_ZPSO: mat.zspo || "",
      Local_visite: mat.localisation || "",
      num_prelevement: prelevementIds,
      resultat,
      materiau_produit: produit || "Non précisé",
      zone: mat.ouvrage || "",
      commentaires: mat.commentaires || ""
    };
  });
}

function normaliserBooleen(valeur) {
  if (valeur === undefined || valeur === null) return false;
  const v = `${valeur}`.trim().toLowerCase();
  return v === "oui" || v === "true" || v === "1" || v === "x";
}
