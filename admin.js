/************************************************************
 *  Initialisation bouton "Choisir le dossier racine"
 ************************************************************/
let allMissions = [];
let currentFilterType = null;   // 'donneur' | 'proprietaire' | ...
let currentFilterValue = null;  // valeur sélectionnée pour le filtre
let selectedDomains = new Set();
let openedDetailId = null;
let scanProgressBar = null;
let scanProgressLabel = null;

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
  const openAmianteFilteredBtn = document.getElementById("openAmianteFiltered");
  const openAnalyseMissionsBtn = document.getElementById("openAnalyseMissions");
  scanProgressBar = document.getElementById("scanProgress");
  scanProgressLabel = document.getElementById("progressLabel");
  if (!rootBtn) {
    console.error("⛔ Bouton #pickRoot introuvable dans la page admin.html");
    return;
  }

  rootBtn.addEventListener("click", async () => {
    try {
      // Ouvre le sélecteur de dossier
      const rootHandle = await window.showDirectoryPicker();
      const prefix = (document.getElementById("prefixInput")?.value || "").trim();

      const eligibleFolders = await collectEligibleFolders(rootHandle, prefix);
      document.getElementById("rootInfo").textContent =
        `📁 Dossier racine : ${rootHandle.name}${prefix ? ` · Préfixe : ${prefix}` : ""} · ${eligibleFolders.length} dossier(s)`;

      if (!eligibleFolders.length) {
        alert("Aucun dossier à scanner avec ce préfixe.");
        resetProgressBar();
        return;
      }

      const confirmed = window.confirm(`Voulez-vous vraiment scanner ces ${eligibleFolders.length} dossiers ?`);
      if (!confirmed) {
        resetProgressBar();
        return;
      }

      resetProgressBar(eligibleFolders.length);

      // Scan
      const missions = await scanRootFolder(rootHandle, prefix, {
        foldersToScan: eligibleFolders,
        onProgress: updateProgressBar
      });
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

  if (openAmianteFilteredBtn) {
    openAmianteFilteredBtn.addEventListener("click", () => {
      const list = filteredMissions();
      const { rows, missing } = collectAmianteRows(list);

      if (!rows.length) {
        alert("Aucune donnée amiante disponible pour les missions filtrées.");
        return;
      }

      if (missing.length) {
        console.warn("Missions sans données amiante ignorées :", missing.join(", "));
      }

      const tables = mergeAmianteTables(list);
      const labelParts = [];
      if (currentFilterType) {
        const filterLabel = (FILTER_TYPES.find(f => f.key === currentFilterType) || {}).label || currentFilterType;
        labelParts.push(`${filterLabel} : ${currentFilterValue || "Tous"}`);
      }
      labelParts.push(`${list.length} mission(s)`);

      const payload = {
        rows,
        tables: Object.keys(tables).length ? tables : null,
        meta: {
          id: "missions-filtrees",
          label: labelParts.join(" · "),
          createdAt: Date.now(),
          source: "filtered-admin"
        }
      };

      const serialized = JSON.stringify(payload);
      sessionStorage.setItem("amianteAutoRows", serialized);
      localStorage.setItem("amianteAutoRows", serialized);
      window.open("amiante.html", "_blank", "noopener");
    });
  }

  if (openAnalyseMissionsBtn) {
    openAnalyseMissionsBtn.addEventListener("click", () => {
      const list = filteredMissions();
      if (!list.length) {
        alert("Aucune mission à transmettre.");
        return;
      }

      const payload = {
        missions: list,
        meta: {
          createdAt: Date.now(),
          source: "admin",
          filter: currentFilterType ? { type: currentFilterType, value: currentFilterValue } : null,
          domains: selectedDomains.size ? Array.from(selectedDomains) : []
        }
      };

      const serialized = JSON.stringify(payload);
      sessionStorage.setItem("missionsAutoPayload", serialized);
      localStorage.setItem("missionsAutoPayload", serialized);
      window.open("analyse_missions.html", "_blank", "noopener");
    });
  }
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

async function collectEligibleFolders(rootHandle, prefix = "") {
  const normalizedPrefix = (prefix || "").trim();
  const folders = [];

  for await (const [name, handle] of rootHandle.entries()) {
    if (handle.kind !== "directory") continue;
    if (normalizedPrefix && !name.startsWith(normalizedPrefix)) continue;
    folders.push({ name, handle });
  }

  return folders;
}

async function scanRootFolder(rootHandle, prefix = "", options = {}) {
  const missions = [];
  const normalizedPrefix = (prefix || "").trim();
  const folders = options.foldersToScan || await collectEligibleFolders(rootHandle, normalizedPrefix);
  let scanned = 0;
  const total = folders.length;

  for (const { name, handle } of folders) {
    const mission = await parseMissionDirectory(handle, name);
    if (mission) missions.push(mission);
    scanned++;
    if (typeof options.onProgress === "function") {
      options.onProgress(scanned, total);
    }
  }
  return missions;
}

function resetProgressBar(total = 0) {
  if (scanProgressBar) {
    scanProgressBar.max = total;
    scanProgressBar.value = 0;
  }
  if (scanProgressLabel) {
    scanProgressLabel.textContent = total ? `0 / ${total} dossiers scannés` : "";
  }
}

function updateProgressBar(scanned, total) {
  if (scanProgressBar) {
    scanProgressBar.max = total;
    scanProgressBar.value = scanned;
  }
  if (scanProgressLabel) {
    scanProgressLabel.textContent = `${scanned} / ${total} dossiers scannés`;
  }
}

async function parseMissionDirectory(dirHandle, folderName) {
  let general = null;
  let conclusions = null;
  let photos = [];
  let domainConclusions = [];
  const domainFlags = new Set();
  const amianteFiles = [];
  let amianteTables = null;
  let photosDir = null;
  let imagesDir = null;

  // Cherche des sous-dossiers utiles (photos / images / XML) mais le scan des fichiers se fait récursivement ensuite.
  for await (const [n, h] of dirHandle.entries()) {
    if (h.kind === "directory") {
      const lower = n.toLowerCase();
      if (lower === "photos") {
        photosDir = h;
      } else if (lower === "images") {
        imagesDir = h;
      }
    }
  }

  await scanMissionFiles(dirHandle, async (fileName, fileHandle) => {
    const lower = fileName.toLowerCase();

    if (lower === "table_general_bien.xml" && !general) {
      general = parseSingleRowTable(await readFileCorrectly(fileHandle));
      return;
    }
    if (lower === "table_general_bien_conclusions.xml" && !conclusions) {
      conclusions = parseMultiRowTable(await readFileCorrectly(fileHandle));
      return;
    }
    if (lower === "table_general_photo.xml" && !photos.length) {
      photos = parsePhotoTable(await readFileCorrectly(fileHandle));
      return;
    }
    if (lower === "table_z_conclusions_details.xml" && !domainConclusions.length) {
      domainConclusions = parseMultiRowTable(await readFileCorrectly(fileHandle));
      return;
    }

    if (DOMAIN_FILES[lower]) {
      domainFlags.add(DOMAIN_FILES[lower]);
    }

    if (lower.startsWith("table_z_amiante") || lower === "table_general_amiante_analyses.xml") {
      amianteFiles.push({ name: fileName, content: await readFileCorrectly(fileHandle) });
    }
  });

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

  let amianteSynthese = null;
  let amianteRows = [];
  if (amianteFiles.length) {
    amianteTables = buildAmianteTablesFromXml(amianteFiles);
    const { rows, synthese } = buildAmianteRowsFromXml(amianteFiles, general);
    amianteRows = rows;
    amianteSynthese = synthese;
  }

  return {
    id: folderName,
    label: folderName,
    general,
    conclusions,
    photos,
    domainConclusions,
    domains: Array.from(domainFlags),
    media,
    amianteRows,
    amianteTables,
    amianteSynthese
  };
}

async function scanMissionFiles(dirHandle, callback) {
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === "file") {
      await callback(name, handle);
    } else if (handle.kind === "directory") {
      await scanMissionFiles(handle, callback);
    }
  }
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

function buildAmianteTablesFromXml(files) {
  const map = {};

  files.forEach(({ name, content }) => {
    const lower = name.toLowerCase();
    const rows = parseGenericXmlRows(content);

    if (lower.includes("table_z_amiante_prelevements")) map["Table_Z_Amiante_prelevements.json"] = rows;
    else if (lower.includes("table_z_amiante_doc_remis")) map["Table_Z_Amiante_doc_remis.json"] = rows;
    else if (lower.includes("table_z_amiante_ecart_norme")) map["Table_Z_Amiante_Ecart_Norme.json"] = rows;
    else if (lower.includes("table_z_amiante_general")) map["Table_Z_Amiante_General.json"] = rows;
    else if (lower.includes("table_general_amiante_analyses")) map["Table_General_Amiante_Analyses.json"] = rows;
    else if (lower.includes("table_z_amiante")) map["Table_Z_Amiante.json"] = rows;
  });

  return map;
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
  const rows = convertirAmianteTablesEnRows(parsed, generalInfo);
  return { rows, synthese };
}

function parseGenericXmlRows(xmlText) {
  const xml = new DOMParser().parseFromString(xmlText, "text/xml");
  if (xml.querySelector("parsererror")) return [];
  const liItems = [...xml.getElementsByTagName("*")].filter(el => /^LiItem_/i.test(el.tagName));
  if (liItems.length) return liItems.map(el => transformerElementEnObjet(el));

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
      const numMat = mat.Num_Materiau
        || mat.Num_materiau
        || mat.num_materiau
        || mat.NumMateriau
        || mat.Num_Mat
        || mat.LiColonne_Reperage_3
        || mat.LiColonne_Id_Prelevement;
      const zspo = mat.ZPSO
        || mat.applicabilite_ZPSO
        || mat.Applicabilite_ZPSO
        || mat.applicabilite_zspo
        || mat.Num_ZPSO
        || mat.LiColonne_Id_Prelevement;
      const prelevementsAssocies = prelevements
        .filter(p => {
          const pMat = p.Num_Materiau
            || p.Num_materiau
            || p.NumMat
            || p.Num_mate
            || p.LiColonne_Num_Materiau
            || p.LiColonne_Reperage_3;
          return numMat && pMat && `${pMat}`.trim() === `${numMat}`.trim();
        })
        .map(p => {
          const resLabo = p.Resultat_reperage
            || p.resultat_reperage
            || p.LiColonne_Resultat_reperage
            || p.Conclusion
            || p.Resultat
            || p["API_Labo_DATA_XML.conclusion_text"]
            || p.conclusion_text
            || "";
          const commentaireLabo = p.Commentaires
            || p.commentaire
            || p.LiColonne_Commentaires_Labo
            || p["API_Labo_DATA_XML.commentaire"]
            || "";
          return {
            id: p.Num_Prelevement || p.LiColonne_Num_Prelevement || p.num_prelevement || p.Id || "",
            resultat: resLabo,
            commentaires_labo: commentaireLabo,
            pv: p.PV || p.pv || p.Justificatif || p.LiColonne_PV_Analyse_Lie || ""
          };
        });

      return {
        localisation: mat.Local_visite || mat.Localisation || mat.LiColonne_Localisation || mat.Zone || "",
        ouvrage: mat.Ouvrage || mat.Ouvrage_porteur || mat.Ouvrage_support || mat.LiColonne_Ouvrages || "",
        partie: mat.Partie || mat.Partie_inspectee || mat.Partie_observee || mat.LiColonne_Partie_Inspectee || "",
        description: mat.materiau_produit || mat.Materiau || mat.Description || mat.LiColonne_Description || "",
        zspo: zspo || (numMat ? `${(generalInfo.prefix_ZPSO || generalInfo.Prefix_ZPSO || "ZPSO-")}${numMat}` : ""),
        resultat: mat.resultat || mat.Resultat || mat.Resultat_reperage || mat.LiColonne_Resultats || "",
        justification: mat.Justification || mat.Mode_operatoire || mat.Mode || mat.LiColonne_Justification || "",
        prelevements: prelevementsAssocies,
        commentaires: mat.commentaires || mat.Commentaire || mat.LiColonne_Commentaire_Etat_Degradation || "",
        photos: mat.photos || mat.Photo || mat.PJ || mat.LiColonne_Photo || ""
      };
    })
  };

  return synthese;
}

function convertirAmianteTablesEnRows(parsed, generalInfo = {}) {
  const clean = (str = "") => `${str}`.replace(/[\x00-\x1F]/g, " ").replace(/\s+/g, " ").trim();
  const buildNumPrelevements = (list, loc) => {
    if (!list || !list.length) return "";
    const parts = `${loc || ""}`.split(";").map(s => clean(s)).filter(Boolean);
    if (parts.length === list.length) return list.map((p, i) => `${p} (${parts[i]})`).join(";");
    const last = parts[parts.length - 1] || "";
    return list.map((p, i) => `${p} (${parts[i] || last})`).join(";");
  };
  const getEtage = loc => {
    const first = `${loc || ""}`.split(";")[0];
    return clean(first.split("-")[0]);
  };

  const Num_EI = clean(generalInfo.LiColonne_Immeuble_Loc_copro || "");
  const Nom_EI = clean(generalInfo.LiColonne_Immeuble_Adresse1 || "");
  const Num_UG = clean(generalInfo.LiColonne_Immeuble_Lot || generalInfo.LiColonne_Loc_Lot || "");
  const Commune = clean(generalInfo.LiColonne_Immeuble_Commune || "");
  const occupation = clean(generalInfo.LiColonne_Immeuble_Occupe_vide || "");
  const date_realisation = clean(generalInfo.LiColonne_Mission_Date_Visite || generalInfo.LiColonne_Gen_Date || "");
  const opNom = clean(generalInfo.LiColonne_Gen_Nom_operateur || "");
  const operateur = opNom ? `SOCOTEC ${opNom}` : "";
  const reference_rapport = clean(generalInfo.LiColonne_Mission_Num_Dossier || generalInfo.LiColonne_Gen_Num_rapport || "");

  const prelevMap = {};
  (parsed.prelevements || []).forEach(prl => {
    const zpso = clean(prl.LiColonne_Data_02 || prl.applicabilite_ZPSO || prl.applicabilite_zspo || prl.LiColonne_Id_Prelevement || "");
    const num = clean(prl.LiColonne_Data_01 || prl.LiColonne_Num_Prelevement || prl.Num_Prelevement || "");
    if (!zpso || !num) return;
    if (!prelevMap[zpso]) prelevMap[zpso] = [];
    prelevMap[zpso].push(num);
  });

  return (parsed.materiaux || []).map(mat => {
    const applicabilite_ZPSO = clean(mat.LiColonne_Id_Prelevement || mat.applicabilite_ZPSO || mat.Num_ZPSO || "");
    const composant_construction = clean(mat.LiColonne_Ouvrages || "");
    const materiau_produit = clean(mat.LiColonne_Description || "");
    const resultat = clean(mat.LiColonne_Resultats || "");
    const etat_conservation = clean(mat.LiColonne_Etat_Conservation || "");
    const Local_visite = clean(mat.LiColonne_Detail_loc || mat.LiColonne_Localisation || "");
    const quantite = clean(mat.LiColonne_SurfaceMateriau || "");
    const unité = clean(mat.LiColonne_SurfaceMateriauUnite || "");

    let prl = [];
    const raw = clean(mat.LiColonne_num_prelevement || mat.num_prelevement || "");
    if (raw) {
      prl = raw.split(";").map(s => clean(s)).filter(Boolean);
    } else if (prelevMap[applicabilite_ZPSO]) {
      prl = [...prelevMap[applicabilite_ZPSO]];
    }

    return {
      Num_EI,
      Nom_EI,
      Num_UG,
      Commune,
      Local_visite,
      Etage: getEtage(Local_visite),
      occupation,
      date_realisation,
      operateur,
      reference_rapport,
      composant_construction,
      materiau_produit,
      num_prelevement: buildNumPrelevements(prl, Local_visite),
      resultat,
      applicabilite_ZPSO,
      etat_conservation,
      quantite,
      unité,
      resultat_Hap: ""
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

function collectAmianteRows(missions = []) {
  const rows = [];
  const missing = [];

  missions.forEach(mission => {
    if (mission.amianteRows && mission.amianteRows.length) {
      rows.push(...mission.amianteRows);
    } else {
      missing.push(mission.label || mission.id || "mission");
    }
  });

  return { rows, missing };
}

function mergeAmianteTables(missions = []) {
  const merged = {};

  missions.forEach(mission => {
    const tables = mission.amianteTables || {};
    Object.entries(tables).forEach(([key, rows]) => {
      if (!Array.isArray(rows)) return;
      if (!merged[key]) merged[key] = [];
      merged[key].push(...rows);
    });
  });

  return merged;
}

function updateAmianteFilteredButton(missions = []) {
  const btn = document.getElementById("openAmianteFiltered");
  if (!btn) return;

  const { rows } = collectAmianteRows(missions);
  btn.disabled = rows.length === 0;
  btn.textContent = rows.length
    ? `Synthèse amiante (${missions.length} mission(s))`
    : "Synthèse amiante (missions filtrées)";
}

function updateAnalyseMissionsButton(missions = []) {
  const btn = document.getElementById("openAnalyseMissions");
  if (!btn) return;

  btn.disabled = missions.length === 0;
  btn.textContent = missions.length
    ? `Analyser (${missions.length} mission(s))`
    : "Analyser dans missions";
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

  updateAmianteFilteredButton(list);
  updateAnalyseMissionsButton(list);

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
    meta: { id: mission.id, label: mission.label, createdAt: Date.now() },
    tables: mission.amianteTables || null,
    synthese: mission.amianteSynthese || null
  };

  const serialized = JSON.stringify(payload);
  sessionStorage.setItem("amianteAutoRows", serialized);
  localStorage.setItem("amianteAutoRows", serialized);
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
