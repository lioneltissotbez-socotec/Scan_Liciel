/************************************************************
 *  Initialisation bouton "Choisir le dossier racine"
 ************************************************************/
let allMissions = [];
let currentFilterType = null;   // 'donneur' | 'proprietaire' | ...
let currentFilterValue = null;  // valeur sélectionnée pour le filtre
let selectedDomains = new Set();
let openedDetailId = null;

const DOMAIN_FILES = {
  "table_z_elec_general.xml": "Électricité",
  "table_z_gaz_general.xml": "Gaz",
  "table_z_dpe_2020_general.xml": "DPE",
  "table_z_crep_general.xml": "Plomb",
  "table_z_carrez_general.xml": "Mesurage Carrez",
  "table_z_amiante_general.xml": "Amiante",
  "table_z_parasites_general.xml": "Parasites",
  "table_z_termites_general.xml": "Termites"
};

window.addEventListener("DOMContentLoaded", () => {
  const rootBtn = document.getElementById("pickRoot");
  if (!rootBtn) {
    console.error("⛔ Bouton #pickRoot introuvable dans la page admin.html");
    return;
  }

  rootBtn.addEventListener("click", async () => {
    try {
      // Ouvre le sélecteur de dossier
      const rootHandle = await window.showDirectoryPicker();

      document.getElementById("rootInfo").textContent =
        "📁 Dossier racine : " + rootHandle.name;

      // Scan
      const missions = await scanRootFolder(rootHandle);
      allMissions = missions;    // ✅ IMPORTANT : on met à jour la variable globale, PAS window.allMissions
      selectedDomains.clear();

      renderFilterButtons();
      renderDomainFilters();
      renderFilterValues();
      renderMissionsTable();

    } catch (err) {
      console.warn("Sélection annulée ou erreur :", err);
    }
  });
});


/********************************************************************
 *  LECTURE FICHIERS & SCAN
 ********************************************************************/
async function readFileCorrectly(fileHandle) {
  const file = await fileHandle.getFile();
  const buffer = await file.arrayBuffer();

  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); } catch (e) {}
  try { return new TextDecoder("iso-8859-1").decode(buffer); } catch (e) {}
  return new TextDecoder("windows-1252").decode(buffer);
}

async function scanRootFolder(rootHandle) {
  const missions = [];

  for await (const [name, handle] of rootHandle.entries()) {
    if (handle.kind === "directory") {
      const mission = await parseMissionDirectory(handle, name);
      if (mission) missions.push(mission);
    }
  }
  return missions;
}

async function parseMissionDirectory(dirHandle, folderName) {
  let general = null;
  let conclusions = null;
  let photos = [];
  let domainConclusions = [];
  const domainFlags = new Set();
  const amianteFiles = [];
  let photosDir = null;
  let imagesDir = null;

  // Cherche un sous-dossier "XML"
  let xmlDir = null;
  for await (const [n, h] of dirHandle.entries()) {
    if (h.kind === "directory") {
      const lower = n.toLowerCase();
      if (lower === "xml") {
        xmlDir = h;
      } else if (lower === "photos") {
        photosDir = h;
      } else if (lower === "images") {
        imagesDir = h;
      }
    }
  }
  const directoriesToScan = [dirHandle];
  if (xmlDir && xmlDir !== dirHandle) directoriesToScan.push(xmlDir);

  for (const target of directoriesToScan) {
    for await (const [fileName, fileHandle] of target.entries()) {
      if (fileHandle.kind !== "file") continue;
      const lower = fileName.toLowerCase();

      if (lower === "table_general_bien.xml") {
        general = parseSingleRowTable(await readFileCorrectly(fileHandle));
      } else if (lower === "table_general_bien_conclusions.xml") {
        conclusions = parseMultiRowTable(await readFileCorrectly(fileHandle));
      } else if (lower === "table_general_photo.xml") {
        photos = parsePhotoTable(await readFileCorrectly(fileHandle));
      } else if (lower === "table_z_conclusions_details.xml") {
        domainConclusions = parseMultiRowTable(await readFileCorrectly(fileHandle));
      } else if (DOMAIN_FILES[lower]) {
        domainFlags.add(DOMAIN_FILES[lower]);
        if (lower.startsWith("table_z_amiante")) {
          amianteFiles.push({ name: fileName, content: await readFileCorrectly(fileHandle) });
        }
      }
    }
  }

  const media = await collectMissionMedia({ photosDir, imagesDir });

  const photoUrls = media.photoUrls || new Map();
  if (photos && photos.length && photoUrls.size) {
    photos = photos.map(p => {
      const key = (p.fichier || "").toLowerCase();
      const url = photoUrls.get(key);
      return url ? { ...p, url } : p;
    });
  }

  if (!general) return null; // pas une mission LICIEL valide

  const amianteRows = amianteFiles.length ? buildAmianteRowsFromXml(amianteFiles, general) : [];

  return {
    id: folderName,
    label: folderName,
    general,
    conclusions,
    photos,
    domainConclusions,
    domains: Array.from(domainFlags),
    media,
    amianteRows
  };
}

async function collectMissionMedia({ photosDir, imagesDir }) {
  const media = { presentationImage: null, dpeEtiquettes: [], photoUrls: new Map() };

  const imageExtensions = /\.(jpe?g|png|webp)$/i;
  const filesToLink = [];

  async function scanDirectory(dirHandle, { allowPresentation = false, allowEtiquette = false } = {}) {
    for await (const [fileName, fileHandle] of dirHandle.entries()) {
      if (fileHandle.kind !== "file") continue;

      const lower = fileName.toLowerCase();

      if (allowPresentation && !media.presentationImage && lower.startsWith("presentation.")) {
        const url = await createObjectUrl(fileHandle);
        if (url) media.presentationImage = { url, name: fileName };
      }

      if (allowEtiquette && lower.includes("etiquette")) {
        const url = await createObjectUrl(fileHandle);
        if (url) media.dpeEtiquettes.push({ url, name: fileName });
      }

      if (imageExtensions.test(lower)) {
        filesToLink.push([lower, fileHandle]);
      }
    }
  }

  if (photosDir) {
    await scanDirectory(photosDir, { allowPresentation: true, allowEtiquette: true });
  }

  if (imagesDir) {
    await scanDirectory(imagesDir, { allowPresentation: true, allowEtiquette: true });
  }

  const resolvedUrls = await Promise.all(filesToLink.map(async ([name, handle]) => [name, await createObjectUrl(handle)]));
  resolvedUrls.forEach(([name, url]) => {
    if (url) media.photoUrls.set(name, url);
  });

  return media;
}

async function createObjectUrl(fileHandle) {
  try {
    const file = await fileHandle.getFile();
    return URL.createObjectURL(file);
  } catch (e) {
    console.warn("Impossible de charger le fichier", e);
    return null;
  }
}

/********************************************************************
 *  PARSEURS XML GÉNÉRIQUES
 ********************************************************************/
function parseSingleRowTable(xmlText) {
  const xml = new DOMParser().parseFromString(xmlText, "text/xml");
  if (xml.querySelector("parsererror")) return {};

  let container = xml.documentElement;
  const item = [...container.children].find(n => n.tagName.startsWith("LiItem_"));
  if (item) container = item;

  const obj = {};
  [...container.children].forEach(c => {
    obj[c.tagName] = (c.textContent || "").trim();
  });
  return obj;
}

function parseMultiRowTable(xmlText) {
  const xml = new DOMParser().parseFromString(xmlText, "text/xml");
  if (xml.querySelector("parsererror")) return [];

  const root = xml.documentElement;
  const items = [...root.children].filter(n => n.tagName.startsWith("LiItem_"));

  return items.map(item => {
    const o = {};
    [...item.children].forEach(c => {
      o[c.tagName] = (c.textContent || "").trim();
    });
    return o;
  });
}

function parsePhotoTable(xmlText) {
  return parseMultiRowTable(xmlText);
}

function buildAmianteRowsFromXml(files, generalInfo = {}) {
  const parsed = { materiaux: [], prelevements: [], documents: [], ecarts: [], general: [] };

  files.forEach(({ name, content }) => {
    const lower = name.toLowerCase();
    const rows = parseGenericXmlRows(content);
    if (lower.includes("table_z_amiante_prelevements")) parsed.prelevements = rows;
    else if (lower.includes("table_z_amiante_doc_remis")) parsed.documents = rows;
    else if (lower.includes("table_z_amiante_ecart_norme")) parsed.ecarts = rows;
    else if (lower.includes("table_z_amiante_general")) parsed.general = rows;
    else if (lower.includes("table_z_amiante")) parsed.materiaux = rows;
  });

  const synthese = construireSyntheseDepuisXml(parsed);
  return convertirSyntheseEnRows(synthese, generalInfo);
}

function parseGenericXmlRows(xmlText) {
  const xml = new DOMParser().parseFromString(xmlText, "text/xml");
  if (xml.querySelector("parsererror")) return [];
  const root = xml.documentElement;
  const children = [...root.children].filter(el => el.nodeType === 1);
  if (!children.length) return [transformerElementEnObjet(root)];
  return children.map(el => transformerElementEnObjet(el));
}

function transformerElementEnObjet(element, prefix = "") {
  const obj = {};
  const keyPrefix = prefix ? `${prefix}.` : "";

  if (element.attributes) {
    [...element.attributes].forEach(attr => {
      obj[`${keyPrefix}${attr.name}`] = (attr.value || "").trim();
    });
  }

  const childElements = [...element.children].filter(el => el.nodeType === 1);
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

  const labNom = generalInfo.Labo_nom || generalInfo.nom_labo || generalInfo.Nom_labo || generalInfo.Labo || "";
  const labAdresse = generalInfo.Labo_adresse || generalInfo.adresse_labo || generalInfo.Adresse_labo || generalInfo.Adresse || "";
  const labVille = generalInfo.Labo_ville || generalInfo.ville_labo || generalInfo.Ville_labo || "";
  const labCofrac = generalInfo.Labo_cofrac || generalInfo.cofrac || generalInfo.COFRAC || "";

  const synthese = {
    general: {
      nb_prelevements: Number(generalInfo.nb_prelevements || generalInfo.Nb_prelevements || generalInfo.Nombre_prelevements || 0),
      prefix_P: generalInfo.prefix_P || generalInfo.Prefix_P || "P",
      prefix_ZPSO: generalInfo.prefix_ZPSO || generalInfo.Prefix_ZPSO || "ZPSO-",
      description_travaux: generalInfo.description_travaux || generalInfo.Description_travaux || "",
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

  return synthese;
}

function convertirSyntheseEnRows(synthese, generalInfo = {}) {
  const commune = generalInfo.LiColonne_Immeuble_Commune || "";
  const adresse = generalInfo.LiColonne_Immeuble_Adresse1 || generalInfo.LiColonne_Immeuble_Batiment || generalInfo.LiColonne_Immeuble_Nom || "";
  const numUG = generalInfo.LiColonne_Loc_Lot || generalInfo.LiColonne_Immeuble_Lot || generalInfo.LiColonne_Immeuble_Loc_copro || generalInfo.LiColonne_Loc_Numero || "UG";
  const date = generalInfo.LiColonne_Gen_Date_rapport || generalInfo.LiColonne_Gen_Date || generalInfo.LiColonne_Gen_Date_mission || "";
  const operateur = generalInfo.LiColonne_Gen_Nom_operateur || generalInfo.LiColonne_Gen_Operateur || "";
  const rapport = generalInfo.LiColonne_Gen_Num_rapport || generalInfo.LiColonne_Gen_Numero_rapport || "";
  const etage = generalInfo.LiColonne_Loc_Etage || generalInfo.LiColonne_Immeuble_Etage || "";

  return (synthese.materiaux || []).map((mat, idx) => {
    const prelevementIds = (mat.prelevements || []).map(p => p.id).filter(Boolean).join(", ");
    const resultat = mat.resultat || (mat.prelevements && mat.prelevements[0] ? mat.prelevements[0].resultat : "");
    const nomEI = mat.localisation || adresse || "Adresse non précisée";
    const produit = mat.description || `${mat.ouvrage || ""} ${mat.partie || ""}`.trim();

    return {
      Nom_EI: nomEI,
      Num_UG: mat.zspo || `${numUG}-${idx + 1}`,
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

/********************************************************************
 *  OUTILS ADMIN : GETTERS POUR FILTRES
 ********************************************************************/
function getField(mission, type) {
  const g = mission.general || {};
  switch (type) {
    case "donneur":        return g.LiColonne_DOrdre_Nom || "";
    case "proprietaire":   return g.LiColonne_Prop_Nom || "";
    case "diagnostiqueur": return g.LiColonne_Gen_Nom_operateur || "";
    case "ville":          return g.LiColonne_Immeuble_Commune || "";
    case "rue":            return g.LiColonne_Immeuble_Adresse1 || "";
    case "batiment":       return g.LiColonne_Immeuble_Loc_copro || g.LiColonne_Immeuble_Lot || "";
    default:               return "";
  }
}

const FILTER_TYPES = [
  { key: "donneur",        label: "Donneur d'ordre" },
  { key: "proprietaire",   label: "Propriétaire" },
  { key: "diagnostiqueur", label: "Diagnostiqueur" },
  { key: "ville",          label: "Ville" },
  { key: "rue",            label: "Rue" },
  { key: "batiment",       label: "Bâtiment" }
];

/********************************************************************
 *  RENDER FILTRES DE DOMAINES
 ********************************************************************/
function getDistinctDomains() {
  const set = new Set();
  allMissions.forEach(m => {
    detectDomains(m).forEach(d => {
      if (d) set.add(d);
    });
  });
  return [...set].sort((a, b) => a.localeCompare(b, "fr"));
}

function renderDomainFilters() {
  const container = document.getElementById("domainFilters");
  if (!container) return;

  container.innerHTML = "";

  const domains = getDistinctDomains();
  if (!domains.length) {
    container.innerHTML = "<p class='muted'>Aucun domaine détecté.</p>";
    return;
  }

  domains.forEach(domain => {
    const label = document.createElement("label");
    label.className = "domain-filter";

    const title = document.createElement("span");
    title.className = "domain-filter__label";
    title.textContent = domain;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = domain;
    checkbox.checked = selectedDomains.has(domain);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedDomains.add(domain);
      } else {
        selectedDomains.delete(domain);
      }
      renderMissionsTable();
    });

    label.appendChild(title);
    label.appendChild(checkbox);
    container.appendChild(label);
  });
}

/********************************************************************
 *  RENDER FILTRES (NIVEAU 1)
 ********************************************************************/
function renderFilterButtons() {
  const container = document.getElementById("filterButtons");
  container.innerHTML = "";

  if (!allMissions.length) {
    container.innerHTML = "<p class='muted'>Aucune mission scannée.</p>";
    return;
  }

  FILTER_TYPES.forEach(ft => {
    const set = new Set();
    allMissions.forEach(m => {
      const v = getField(m, ft.key);
      if (v) set.add(v);
    });
    const distinctCount = set.size;
    if (distinctCount === 0) return;

    const btn = document.createElement("button");
    btn.className = "filter-btn" + (currentFilterType === ft.key ? " active" : "");
    btn.innerHTML = `
      <span>${ft.label}</span>
      <span class="count">${distinctCount}</span>
    `;
    btn.addEventListener("click", () => {
      if (currentFilterType === ft.key) {
        currentFilterType = null;
        currentFilterValue = null;
      } else {
        currentFilterType = ft.key;
        currentFilterValue = null;
      }
      renderFilterButtons();
      renderFilterValues();
      renderMissionsTable();
    });
    container.appendChild(btn);
  });
}

/********************************************************************
 *  RENDER VALEURS (NIVEAU 2)
 ********************************************************************/
function renderFilterValues() {
  const block = document.getElementById("filterValuesBlock");
  const container = document.getElementById("filterValues");
  const title = document.getElementById("filterValuesTitle");
  container.innerHTML = "";

  if (!currentFilterType) {
    block.style.display = "none";
    return;
  }

  block.style.display = "block";

  const ft = FILTER_TYPES.find(f => f.key === currentFilterType);
  title.textContent = ft ? ft.label : "Valeurs";

  const counts = new Map();
  allMissions.forEach(m => {
    const v = getField(m, currentFilterType);
    if (!v) return;
    counts.set(v, (counts.get(v) || 0) + 1);
  });

  const entries = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], "fr"));

  const allItem = document.createElement("div");
  allItem.className = "filter-value-item" + (currentFilterValue === null ? " active" : "");
  allItem.innerHTML = `<span>🌐 Tous</span><span>${allMissions.length}</span>`;
  allItem.addEventListener("click", () => {
    currentFilterValue = null;
    renderFilterValues();
    renderMissionsTable();
  });
  container.appendChild(allItem);

  entries.forEach(([val, count]) => {
    const div = document.createElement("div");
    div.className = "filter-value-item" + (currentFilterValue === val ? " active" : "");
    div.innerHTML = `<span>${escapeHtml(val)}</span><span>${count}</span>`;
    div.addEventListener("click", () => {
      currentFilterValue = val;
      renderFilterValues();
      renderMissionsTable();
    });
    container.appendChild(div);
  });
}

/********************************************************************
 *  TABLE DES MISSIONS
 ********************************************************************/
function filteredMissions() {
  let data = allMissions.slice();
  if (currentFilterType && currentFilterValue !== null) {
    data = data.filter(m => getField(m, currentFilterType) === currentFilterValue);
  }
  if (selectedDomains.size) {
    const required = [...selectedDomains];
    data = data.filter(m => {
      const domains = detectDomains(m);
      return required.every(d => domains.includes(d));
    });
  }
  return data;
}

function detectDomains(mission) {
  if (mission.domains && mission.domains.length) {
    return Array.from(new Set(mission.domains));
  }

  const result = new Set();
  if (mission.domainConclusions && mission.domainConclusions.length) {
    const hasAmiante = mission.domainConclusions.some(d =>
      (d.Conclusion_Amiante || d.Etat_Amiante || "").trim()
    );
    const hasPlomb = mission.domainConclusions.some(d =>
      (d.CREP_Classement || "").trim()
    );
    const hasDPE = mission.domainConclusions.some(d =>
      (d.DPE_Conclusion || d.DPE_Etiquette || "").trim()
    );
    if (hasAmiante) result.add("Amiante");
    if (hasPlomb) result.add("Plomb");
    if (hasDPE) result.add("DPE");
  }

  if (mission.conclusions && mission.conclusions.length) {
    mission.conclusions.forEach(c => {
      const domain = (c.LiColonne_nom || "").trim();
      const text = (c.LiColonne_conclusion_liciel || "").trim();
      if (domain && text) {
        result.add(domain);
      }
    });
  }

  return Array.from(result);
}

function renderMissionsTable() {
  const container = document.getElementById("missionsList");
  const list = filteredMissions();

  document.getElementById("missionsCount").textContent = list.length + " mission(s)";

  if (!list.length) {
    container.innerHTML = "<p class='muted'>Aucune mission ne correspond au filtre.</p>";
    return;
  }

  let html = `
    <table class="missionTable">
      <thead>
        <tr>
          <th></th>
          <th>Dossier</th>
          <th>Adresse</th>
          <th>Ville</th>
          <th>Donneur d'ordre</th>
          <th>Propriétaire</th>
          <th>Diagnostiqueur</th>
          <th>Date visite</th>
          <th>Domaines</th>
        </tr>
      </thead>
      <tbody>
  `;

  list.forEach(m => {
    const g = m.general || {};
    const domaines = detectDomains(m).join(", ");

    html += `
      <tr class="mission-row" data-id="${escapeHtml(m.id)}">
        <td><button class="detail-btn" data-id="${escapeHtml(m.id)}">Voir</button></td>
        <td>${escapeHtml(g.LiColonne_Mission_Num_Dossier || "")}</td>
        <td>${escapeHtml(g.LiColonne_Immeuble_Adresse1 || "")}</td>
        <td>${escapeHtml(g.LiColonne_Immeuble_Commune || "")}</td>
        <td>${escapeHtml(g.LiColonne_DOrdre_Nom || "")}</td>
        <td>${escapeHtml(g.LiColonne_Prop_Nom || "")}</td>
        <td>${escapeHtml(g.LiColonne_Gen_Nom_operateur || "")}</td>
        <td>${escapeHtml(g.LiColonne_Mission_Date_Visite || "")}</td>
        <td>${escapeHtml(domaines)}</td>
      </tr>
    `;
  });

  html += "</tbody></table>";
  container.innerHTML = html;

  container.querySelectorAll(".detail-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const row = btn.closest("tr");
      if (openedDetailId === btn.dataset.id) {
        closeInlineDetail();
        return;
      }
      showMissionDetail(btn.dataset.id, row);
    });
  });
}

/********************************************************************
 *  DÉTAIL MISSION ADMINISTRATIF
 ********************************************************************/
function closeInlineDetail() {
  const existing = document.querySelector(".detail-row");
  if (existing) existing.remove();
  openedDetailId = null;
}

function showMissionDetail(id, anchorRow) {
  const mission = allMissions.find(m => m.id === id);
  closeInlineDetail();

  if (!mission || !anchorRow) return;

  openedDetailId = id;

  const detailRow = document.createElement("tr");
  detailRow.className = "detail-row";

  const cell = document.createElement("td");
  cell.colSpan = anchorRow.children.length;
  cell.innerHTML = `<div class="inline-detail">${buildMissionDetailHtml(mission)}</div>`;

  detailRow.appendChild(cell);
  anchorRow.insertAdjacentElement("afterend", detailRow);

  const closeBtn = detailRow.querySelector(".inline-detail__close");
  if (closeBtn) {
    closeBtn.addEventListener("click", closeInlineDetail);
  }
}

function buildMissionDetailHtml(mission) {
  if (!mission) {
    return "<p class='muted'>Mission introuvable.</p>";
  }

  const domainActions = buildDomainActions(mission);

  let html = `
    <div class="inline-detail__header">
      <div class="inline-detail__title">Détail de la mission – ${escapeHtml(mission.label || mission.id)}</div>
      <div class="inline-detail__actions">
        ${domainActions}
        <button class="inline-detail__close" type="button">Fermer</button>
      </div>
    </div>
    <div class="detail-section"><h3>Identité mission</h3><div class="info-grid">
  `;
  const g = mission.general || {};
  const blocks = [
    buildFieldGroup("Donneur d'ordre", [
      ["Type d'ordre", g.LiColonne_DOrdre_Type],
      ["Entête", g.LiColonne_DOrdre_Entete],
      ["Nom", g.LiColonne_DOrdre_Nom],
      ["Adresse", g.LiColonne_DOrdre_Adresse1],
      ["Département", g.LiColonne_DOrdre_Departement],
      ["Commune", g.LiColonne_DOrdre_Commune]
    ]),
    buildFieldGroup("Propriétaire", [
      ["Entête", g.LiColonne_Prop_Entete],
      ["Nom", g.LiColonne_Prop_Nom],
      ["Adresse", g.LiColonne_Prop_Adresse1],
      ["Département", g.LiColonne_Prop_Departement],
      ["Commune", g.LiColonne_Prop_Commune]
    ]),
    buildFieldGroup("Bien", [
      ["Adresse de l'immeuble", g.LiColonne_Immeuble_Adresse1],
      ["Complément", g.LiColonne_Immeuble_Description],
      ["Code postal", g.LiColonne_Immeuble_Departement],
      ["Commune", g.LiColonne_Immeuble_Commune],
      ["Lot / référence", g.LiColonne_Immeuble_Lot],
      ["Localisation copropriété", g.LiColonne_Immeuble_Loc_copro],
      ["Cadastre", g.LiColonne_Immeuble_Cadastre],
      ["Nature du bien", g.LiColonne_Immeuble_Nature_bien],
      ["Type de bien", g.LiColonne_Immeuble_Type_bien],
      ["Type de dossier", g.LiColonne_Immeuble_Type_Dossier],
      ["Occupé / vide", g.LiColonne_Immeuble_Occupe_vide],
      ["Accompagnateur", g.LiColonne_Immeuble_Accompagnateur]
    ]),
    buildFieldGroup("Diagnostiqueur", [
      ["Nom complet", g.LiColonne_Gen_Nom_operateur],
      ["Nom", g.LiColonne_Gen_Nom_operateur_UniquementNomFamille],
      ["Prénom", g.LiColonne_Gen_Nom_operateur_UniquementPreNom],
      ["Certification société", g.LiColonne_Gen_certif_societe]
    ]),
    buildFieldGroup("Missions concernées", [
      ["N° dossier", g.LiColonne_Mission_Num_Dossier],
      ["Missions programmées", g.LiColonne_Mission_Missions_programmees],
      ["Durée de mission", g.LiColonne_Mission_Duree_mission],
      ["Heure d'arrivée", g.LiColonne_Mission_Heure_Arrivee],
      ["Date de visite", g.LiColonne_Mission_Date_Visite],
      ["Date du rapport", g.LiColonne_Mission_Date_Rapport],
      ["Mémo terrain", g.LiColonne_Texte_memo_terrain],
      ["Notes libres", g.LiColonne_Notes_libres]
    ])
  ];

  blocks.forEach(block => { html += block; });
  html += `</div></div>`;

  if (mission.conclusions && mission.conclusions.length) {
    const filled = mission.conclusions.filter(c => c.LiColonne_conclusion_liciel && c.LiColonne_conclusion_liciel.trim());
    if (filled.length) {
      const grouped = new Map();
      filled.forEach(c => {
        const domain = c.LiColonne_nom || "Conclusion";
        const text = c.LiColonne_conclusion_liciel;
        if (!grouped.has(domain)) {
          grouped.set(domain, []);
        }
        grouped.get(domain).push(text);
      });

      html += `<div class="detail-section"><h3>Bloc Conclusions</h3><div class="conclusion-board"><div class="conclusion-grid">`;
      grouped.forEach((texts, domain) => {
        html += `<div class="conclusion-card">`;
        html += `<div class="conclusion-title">${escapeHtml(domain)}</div>`;
        texts.forEach(t => {
          html += `<p>${escapeHtml(t)}</p>`;
        });
        html += `</div>`;
      });
      html += `</div></div></div>`;
    }
  }

  if (mission.domainConclusions && mission.domainConclusions.length) {
    const filtered = mission.domainConclusions.filter(c =>
      c.Etat_Amiante || c.Conclusion_Amiante || c.CREP_Classement || c.DPE_Conclusion || c.DPE_Etiquette
    );
    if (filtered.length) {
      html += `<div class="detail-section"><h3>Conclusions par domaine</h3><div class="conclusion-board"><div class="conclusion-grid">`;
      filtered.forEach(c => {
        html += `<div class="conclusion-card">`;
        if (c.Conclusion_Amiante || c.Etat_Amiante) {
          html += `<div class="pill-label">Amiante</div>`;
          if (c.Conclusion_Amiante) html += `<p>${escapeHtml(c.Conclusion_Amiante)}</p>`;
          if (c.Etat_Amiante) html += `<p>${escapeHtml(c.Etat_Amiante)}</p>`;
        }
        if (c.CREP_Classement) {
          html += `<div class="pill-label">Plomb</div>`;
          html += `<p>${escapeHtml(c.CREP_Classement)}</p>`;
        }
        if (c.DPE_Conclusion || c.DPE_Etiquette) {
          html += `<div class="pill-label">DPE</div>`;
          if (c.DPE_Conclusion) html += `<p>${escapeHtml(c.DPE_Conclusion)}</p>`;
          if (c.DPE_Etiquette) html += `<p>${escapeHtml(c.DPE_Etiquette)}</p>`;
        }
        html += `</div>`;
      });
      html += `</div></div></div>`;
    }
  }

  const media = mission.media || {};
  const hasPresentation = !!media.presentationImage;
  const hasEtiquettes = media.dpeEtiquettes && media.dpeEtiquettes.length;
  const linkedPhotos = (mission.photos || []).filter(p => p.url);
  const hasPhotoMeta = linkedPhotos.length > 0;

  if (hasPresentation || hasEtiquettes || hasPhotoMeta) {
    html += `<div class="detail-section"><h3>Présentation et Images</h3><div class="photo-grid">`;

    if (hasPresentation) {
      html += `
        <div class="photo-card">
          <div class="photo-card__image">
            <img src="${media.presentationImage.url}" alt="Présentation du bien" loading="lazy" />
          </div>
          <div class="photo-card__title">Présentation du bien</div>
          <div class="muted">${escapeHtml(media.presentationImage.name || "presentation.jpg")}</div>
        </div>
      `;
    }

    if (hasEtiquettes) {
      media.dpeEtiquettes.forEach((etiquette, idx) => {
        html += `
          <div class="photo-card">
            <div class="photo-card__image">
              <img src="${etiquette.url}" alt="Étiquette DPE ${escapeHtml(etiquette.name || "")}" loading="lazy" />
            </div>
            <div class="photo-card__title">Étiquette DPE ${idx + 1}</div>
            <div class="muted">${escapeHtml(etiquette.name || "Étiquette DPE")}</div>
          </div>
        `;
      });
    }

    if (hasPhotoMeta) {
      linkedPhotos.forEach(p => {
        html += `
          <div class="photo-card photo-card--meta">
            <div class="photo-card__image"><img src="${p.url}" alt="${escapeHtml(p.Titre || "Photo")}" loading="lazy" /></div>
            <div class="photo-card__title">${escapeHtml(p.Titre || "Photo")}</div>
            ${p.legende ? `<div class="photo-card__legend">${escapeHtml(p.legende)}</div>` : ""}
            ${p.fichier ? `<div class="pill-label">${escapeHtml(p.fichier)}</div>` : ""}
            ${p.date ? `<div class='muted'>${escapeHtml(p.date)}</div>` : ""}
          </div>
        `;
      });
    }

    html += `</div></div>`;
  }

  return html;
}

function buildFieldGroup(title, pairs) {
  const filledPairs = pairs.filter(([, value]) => value && value.trim());
  if (!filledPairs.length) return "";

  const content = filledPairs.map(([label, value]) =>
    `<p><span class="pill-label">${escapeHtml(label)}</span><span class="pill-value">${escapeHtml(value)}</span></p>`
  ).join("");

  return `<div class="info-card"><div class="info-card__header">${escapeHtml(title)}</div>${content}</div>`;
}

function buildDomainActions(mission) {
  const domains = detectDomains(mission);
  const hasAmianteData = mission.amianteRows && mission.amianteRows.length;
  if (!domains.length && !hasAmianteData) return "";

  const links = [];
  if (domains.includes("Amiante") || hasAmianteData) {
    const safeId = (mission.id || "").replace(/'/g, "&#39;");
    links.push(`<button class="domain-action-btn" type="button" onclick="openAmianteForMission('${safeId}')">Synthèse amiante</button>`);
  }

  if (!links.length) return "";

  return `<div class="domain-actions"><span class="domain-actions__label">Modules :</span>${links.join("")}</div>`;
}

/********************************************************************
 *  ESCAPE HTML
 ********************************************************************/
function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c] || c));
}

window.openAmianteForMission = function (missionId) {
  const mission = allMissions.find(m => m.id === missionId);
  if (!mission || !mission.amianteRows || !mission.amianteRows.length) {
    alert("Aucune donnée amiante disponible pour cette mission.");
    return;
  }

  const payload = {
    rows: mission.amianteRows,
    meta: { id: mission.id, label: mission.label }
  };

  sessionStorage.setItem("amianteAutoRows", JSON.stringify(payload));
  window.open("amiante.html", "_blank", "noopener");
};

/**
 * Convertit un nom de colonne XML en libellé plus lisible pour l'affichage.
 */
function formatLabel(rawKey) {
  if (!rawKey) return "";
  const cleaned = rawKey.replace(/^LiColonne_/i, "").replace(/_/g, " ");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
