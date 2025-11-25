// Explorateur missions LICIEL – Vue administrative uniquement
// Lionel : une seule page, tout en vanilla JS. Aucune dépendance externe.

let rootHandle = null;
let allMissions = [];
let filterIndex = null;
let currentFilterDim = null;
let currentFilterValue = null;

// ========= Utilitaires lecture fichiers =========
async function readFileCorrectlyFromHandle(fileHandle) {
  const file = await fileHandle.getFile();
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (e) {}
  try {
    return new TextDecoder("iso-8859-1").decode(buffer);
  } catch (e) {}
  return new TextDecoder("windows-1252").decode(buffer);
}

function parseXmlSafely(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "text/xml");
  const err = doc.querySelector("parsererror");
  if (err) {
    console.error("Erreur XML:", err.textContent);
  }
  return doc;
}

function getText(root, tagName) {
  const el = root.getElementsByTagName(tagName)[0];
  return el && el.textContent ? el.textContent.trim() : "";
}

function extractStreetFromAdresse(adresse) {
  if (!adresse) return "";
  const txt = adresse.trim();
  const m = txt.match(/^\S+\s+(.+)$/);
  return m ? m[1].trim() : txt;
}

// ========= Parsing des différents XML =========
function parseGeneralBien(xmlText) {
  const doc = parseXmlSafely(xmlText);
  const root = doc.documentElement;
  if (!root) return null;

  const donorName = getText(root, "LiColonne_DOrdre_Nom");
  const donorType = getText(root, "LiColonne_DOrdre_Type");
  const donorAdresse = getText(root, "LiColonne_DOrdre_Adresse1");
  const donorCP = getText(root, "LiColonne_DOrdre_Departement");
  const donorCommune = getText(root, "LiColonne_DOrdre_Commune");

  const propName = getText(root, "LiColonne_Prop_Nom");
  const propAdresse = getText(root, "LiColonne_Prop_Adresse1");
  const propCP = getText(root, "LiColonne_Prop_Departement");
  const propCommune = getText(root, "LiColonne_Prop_Commune");

  const immeubleAdresse1 = getText(root, "LiColonne_Immeuble_Adresse1");
  const immeubleCP = getText(root, "LiColonne_Immeuble_Departement");
  const immeubleCommune = getText(root, "LiColonne_Immeuble_Commune");
  const immeubleLocCopro = getText(root, "LiColonne_Immeuble_Loc_copro");
  const immeubleNature = getText(root, "LiColonne_Immeuble_Nature_bien");
  const immeubleTypeBien = getText(root, "LiColonne_Immeuble_Type_bien");
  const immeubleTypeDossier = getText(root, "LiColonne_Immeuble_Type_Dossier");
  const immeubleOccupe = getText(root, "LiColonne_Immeuble_Occupe_vide");

  const missionNum = getText(root, "LiColonne_Mission_Num_Dossier");
  const missionDateVisite = getText(root, "LiColonne_Mission_Date_Visite");
  const missionDateRapport = getText(root, "LiColonne_Mission_Date_Rapport");
  const missionDuree = getText(root, "LiColonne_Mission_Duree_mission");
  const missionArrivee = getText(root, "LiColonne_Mission_Heure_Arrivee");
  const missionNotes = getText(root, "LiColonne_Notes_libres");
  const missionMemoTerrain = getText(root, "LiColonne_Texte_memo_terrain");

  const diagNom = getText(root, "LiColonne_Gen_Nom_operateur");
  const diagInitiales = getText(root, "LiColonne_Gen_Initiales_operateur");
  const diagCertSociete = getText(root, "LiColonne_Gen_certif_societe");
  const diagCertNum = getText(root, "LiColonne_Gen_num_certif");
  const diagCertDate = getText(root, "LiColonne_Gen_certif_date");
  const versionLogiciel = getText(root, "LiColonne_VersionLogiciel");

  const rue = extractStreetFromAdresse(immeubleAdresse1);
  const batiment = immeubleLocCopro || "";

  return {
    donorName,
    donorType,
    donorAdresse,
    donorCP,
    donorCommune,
    propName,
    propAdresse,
    propCP,
    propCommune,
    immeubleAdresse1,
    immeubleCP,
    immeubleCommune,
    immeubleLocCopro,
    immeubleNature,
    immeubleTypeBien,
    immeubleTypeDossier,
    immeubleOccupe,
    missionNum,
    missionDateVisite,
    missionDateRapport,
    missionDuree,
    missionArrivee,
    missionNotes,
    missionMemoTerrain,
    diagNom,
    diagInitiales,
    diagCertSociete,
    diagCertNum,
    diagCertDate,
    versionLogiciel,
    rue,
    batiment,
    ville: immeubleCommune
  };
}

function parseGeneralBienConclusions(xmlText) {
  const doc = parseXmlSafely(xmlText);
  const items = [...doc.getElementsByTagName("LiItem_table_General_Bien_conclusions")];
  return items.map(item => ({
    nom: getText(item, "LiColonne_nom"),
    conclusion: getText(item, "LiColonne_conclusion_liciel") || getText(item, "LiColonne_conclusion")
  })).filter(x => x.nom);
}

function parseDescriptionGeneral(xmlText) {
  const doc = parseXmlSafely(xmlText);
  const root = doc.documentElement;
  if (!root) return null;

  return {
    listeImmeuble: getText(root, "LiColonne_Liste_Immeuble"),
    listeAppartement: getText(root, "LiColonne_Liste_Appertement"),
    listeAnnexes: getText(root, "LiColonne_Liste_Annexes"),
    commentaires: getText(root, "LiColonne_Txt_commentaires_generales")
  };
}

function parseGeneralPhotos(xmlText) {
  const doc = parseXmlSafely(xmlText);
  const items = [...doc.getElementsByTagName("LiItem_table_General_Photo")];
  return items.map(item => ({
    idClassement: getText(item, "LiColonne_id_classement_champs"),
    clefComposant: getText(item, "LiColonne_ClefComposant"),
    codePhoto: getText(item, "LiColonne_Photo"),
    localisation: getText(item, "LiColonne_Localistion"),
    prestation: getText(item, "LiColonne_Prestation"),
    ouvrage: getText(item, "LiColonne_Ouvrage_txt_complet") || getText(item, "LiColonne_Ouvrage"),
    partie: getText(item, "LiColonne_Partie"),
    description: getText(item, "LiColonne_Description"),
    cheminAcces: getText(item, "LiColonne_Chemin_acces")
  }));
}

function parseZConclusionsDetails(xmlText) {
  const doc = parseXmlSafely(xmlText);
  const root = doc.documentElement;
  if (!root) return null;
  return {
    amiante: getText(root, "LiColonne_Variable_resume_conclusion_amiante"),
    crep: getText(root, "LiColonne_Variable_resume_conclusion_crep"),
    termites: getText(root, "LiColonne_Variable_resume_conclusion_termites"),
    parasites: getText(root, "LiColonne_Variable_resume_conclusion_autres_parasites"),
    dpe: getText(root, "LiColonne_Variable_resume_conclusion_dpe")
  };
}

// ========= Scan des missions =========
async function parseMissionFromDir(dirHandle, label) {
  let xmlDir = null;

  // D'abord chercher un sous-dossier XML
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === "directory" && name.toLowerCase() === "xml") {
      xmlDir = handle;
      break;
    }
  }

  const targetDir = xmlDir || dirHandle;

  let generalText = null;
  let generalConclText = null;
  let descText = null;
  let photoText = null;
  let zConclText = null;

  for await (const [name, handle] of targetDir.entries()) {
    if (handle.kind !== "file") continue;
    const lower = name.toLowerCase();
    if (lower === "table_general_bien.xml") {
      generalText = await readFileCorrectlyFromHandle(handle);
    } else if (lower === "table_general_bien_conclusions.xml") {
      generalConclText = await readFileCorrectlyFromHandle(handle);
    } else if (lower === "table_general_desciption_general.xml") {
      descText = await readFileCorrectlyFromHandle(handle);
    } else if (lower === "table_general_photo.xml") {
      photoText = await readFileCorrectlyFromHandle(handle);
    } else if (lower === "table_z_conclusions_details.xml") {
      zConclText = await readFileCorrectlyFromHandle(handle);
    }
  }

  if (!generalText) {
    return null; // pas une mission LICIEL exploitable
  }

  const general = parseGeneralBien(generalText);
  const bienConclusions = generalConclText ? parseGeneralBienConclusions(generalConclText) : [];
  const description = descText ? parseDescriptionGeneral(descText) : null;
  const photos = photoText ? parseGeneralPhotos(photoText) : [];
  const zConclusions = zConclText ? parseZConclusionsDetails(zConclText) : null;

  // Domaines identifiés = lignes de Table_General_Bien_conclusions avec un nom
  const domains = bienConclusions.map(c => c.nom).filter(Boolean);

  return {
    id: label,
    label,
    dirHandle,
    general,
    bienConclusions,
    description,
    photos,
    zConclusions,
    domains
  };
}

async function scanRootDirectory(rootDirHandle) {
  const missions = [];
  for await (const [name, handle] of rootDirHandle.entries()) {
    if (handle.kind !== "directory") continue;
    const mission = await parseMissionFromDir(handle, name);
    if (mission) {
      missions.push(mission);
    }
  }
  return missions;
}

// ========= Indexation pour les filtres =========
function buildFilterIndex(missions) {
  const makeMap = () => new Map();
  const idx = {
    donneur: makeMap(),
    proprietaire: makeMap(),
    diagnostiqueur: makeMap(),
    ville: makeMap(),
    rue: makeMap(),
    batiment: makeMap()
  };

  missions.forEach((m, i) => {
    const g = m.general || {};
    const entries = [
      ["donneur", g.donorName],
      ["proprietaire", g.propName],
      ["diagnostiqueur", g.diagNom],
      ["ville", g.ville],
      ["rue", g.rue],
      ["batiment", g.batiment]
    ];

    entries.forEach(([dim, val]) => {
      if (!val) return;
      const map = idx[dim];
      if (!map.has(val)) map.set(val, []);
      map.get(val).push(i);
    });
  });

  return idx;
}

// ========= Rendu UI : filtrage =========
function updateFilterButtonsCounts() {
  if (!filterIndex) return;
  ["donneur","proprietaire","diagnostiqueur","ville","rue","batiment"].forEach(dim => {
    const span = document.querySelector(`span[data-count="${dim}"]`);
    if (span) {
      const map = filterIndex[dim];
      span.textContent = map ? map.size : 0;
    }
  });
}

function renderFilterValues(dim) {
  const container = document.getElementById("filterValuesContainer");
  const title = document.getElementById("filterValuesTitle");
  const buttons = document.getElementById("filterValuesButtons");
  const map = filterIndex[dim];

  buttons.innerHTML = "";
  currentFilterValue = null;

  const dimLabel = {
    donneur: "donneur d'ordre",
    proprietaire: "propriétaire",
    diagnostiqueur: "diagnostiqueur",
    ville: "ville",
    rue: "rue",
    batiment: "bâtiment / loc. copro"
  }[dim] || dim;

  if (!map || map.size === 0) {
    title.textContent = `Aucune valeur trouvée pour le ${dimLabel}.`;
    container.style.display = "block";
    renderMissionsTable(allMissions);
    return;
  }

  title.textContent = `Valeurs pour le ${dimLabel} :`;

  // bouton "Tous"
  const allBtn = document.createElement("button");
  allBtn.textContent = `Tous (${allMissions.length})`;
  allBtn.classList.add("active");
  allBtn.dataset.value = "";
  buttons.appendChild(allBtn);

  const sorted = Array.from(map.entries()).sort((a,b) => {
    return a[0].localeCompare(b[0], "fr", { sensitivity: "base" });
  });

  sorted.forEach(([val, missionIdxs]) => {
    const btn = document.createElement("button");
    btn.textContent = `${val} (${missionIdxs.length})`;
    btn.dataset.value = val;
    buttons.appendChild(btn);
  });

  container.style.display = "block";

  // Gestion des clics sur les valeurs
  buttons.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      buttons.querySelectorAll("button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const val = btn.dataset.value || "";
      currentFilterValue = val || null;

      if (!currentFilterValue) {
        renderMissionsTable(allMissions);
      } else {
        const map = filterIndex[currentFilterDim];
        const idxs = map.get(currentFilterValue) || [];
        const subset = idxs.map(i => allMissions[i]);
        renderMissionsTable(subset);
      }
    });
  });

  // Par défaut : tous
  renderMissionsTable(allMissions);
}

// ========= Rendu UI : tableau des missions =========
function renderMissionsTable(missions) {
  const card = document.getElementById("missionsCard");
  const tbody = document.querySelector("#missionsTable tbody");
  const summary = document.getElementById("missionsSummary");

  tbody.innerHTML = "";

  if (!missions || missions.length === 0) {
    summary.textContent = "Aucune mission ne correspond aux critères actuels.";
    card.style.display = "block";
    return;
  }

  summary.textContent = `${missions.length} mission(s) affichée(s).`;

  missions.forEach(mission => {
    const g = mission.general || {};
    const tr = document.createElement("tr");

    const domainsText = mission.domains && mission.domains.length
      ? mission.domains.join(", ")
      : "";

    tr.innerHTML = `
      <td>${escapeHtml(g.missionNum || mission.label)}</td>
      <td>${escapeHtml(g.immeubleAdresse1 || "")}</td>
      <td>${escapeHtml(g.ville || "")}</td>
      <td>${escapeHtml(g.batiment || "")}</td>
      <td>${escapeHtml(g.donorName || "")}</td>
      <td>${escapeHtml(g.propName || "")}</td>
      <td>${escapeHtml(g.diagNom || "")}</td>
      <td>${escapeHtml(g.missionDateVisite || "")}</td>
      <td>${domainsText ? domainsText.split(",").map(d => `<span class="domain-pill">${escapeHtml(d.trim())}</span>`).join(" ") : ""}</td>
      <td><button class="secondary" data-mission-id="${mission.id}">Détail</button></td>
    `;
    tbody.appendChild(tr);
  });

  card.style.display = "block";

  tbody.querySelectorAll("button[data-mission-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-mission-id");
      const mission = allMissions.find(m => m.id === id);
      if (mission) {
        showMissionDetail(mission);
      }
    });
  });
}

// ========= Détail mission =========
function showMissionDetail(mission) {
  const card = document.getElementById("detailCard");
  const container = document.getElementById("detailContent");
  const g = mission.general || {};
  const desc = mission.description || {};
  const z = mission.zConclusions || {};
  const bienConcl = mission.bienConclusions || [];

  // Regrouper les conclusions par domaine lisible
  const domainLabels = {
    "Amiante": "Amiante",
    "Termites": "Termites",
    "Parasites": "Autres parasites",
    "DPE": "DPE",
    "CREP": "CREP",
    "Etat Habitabilité": "État d'habitabilité",
    "Gaz": "Gaz",
    "Electricité": "Électricité"
  };

  const domainRows = [];
  bienConcl.forEach(row => {
    if (!row.nom) return;
    const key = row.nom;
    const label = domainLabels[key] || key;
    const synth = row.conclusion || "";
    if (synth) {
      domainRows.push({ label, synth });
    }
  });

  const zRows = [];
  if (z) {
    if (z.amiante) zRows.push({ label: "Amiante (résumé détaillé)", synth: z.amiante });
    if (z.crep) zRows.push({ label: "CREP (résumé détaillé)", synth: z.crep });
    if (z.termites) zRows.push({ label: "Termites (résumé détaillé)", synth: z.termites });
    if (z.parasites) zRows.push({ label: "Autres parasites (résumé détaillé)", synth: z.parasites });
    if (z.dpe) zRows.push({ label: "DPE (résumé détaillé)", synth: z.dpe });
  }

  const descriptionParts = [];
  if (desc.listeImmeuble) descriptionParts.push(`<p><span class="detail-label">Équipements immeuble :</span> ${escapeHtml(desc.listeImmeuble)}</p>`);
  if (desc.listeAppartement) descriptionParts.push(`<p><span class="detail-label">Équipements appartement :</span> ${escapeHtml(desc.listeAppartement)}</p>`);
  if (desc.listeAnnexes) descriptionParts.push(`<p><span class="detail-label">Annexes :</span> ${escapeHtml(desc.listeAnnexes)}</p>`);
  if (desc.commentaires) descriptionParts.push(`<p><span class="detail-label">Commentaires généraux :</span> ${escapeHtml(desc.commentaires)}</p>`);

  const domainsHtml = domainRows.length || zRows.length
    ? `
      <div class="detail-block">
        <h3>Synthèse des repérages</h3>
        <div class="detail-list">
          ${domainRows.map(d => `<p><span class="detail-label">${escapeHtml(d.label)} :</span> ${escapeHtml(d.synth)}</p>`).join("")}
          ${zRows.map(d => `<p><span class="detail-label">${escapeHtml(d.label)} :</span><br>${escapeHtml(d.synth)}</p>`).join("")}
        </div>
      </div>
    `
    : "";

  container.innerHTML = `
    <div class="detail-grid">
      <div>
        <div class="detail-block">
          <h3>Identification de la mission</h3>
          <div class="detail-list">
            <p><span class="detail-label">N° dossier :</span> ${escapeHtml(g.missionNum || mission.label)}</p>
            <p><span class="detail-label">Type dossier :</span> ${escapeHtml(g.immeubleTypeDossier || "")}</p>
            <p><span class="detail-label">Nature du bien :</span> ${escapeHtml(g.immeubleNature || "")}</p>
            <p><span class="detail-label">Type de bien :</span> ${escapeHtml(g.immeubleTypeBien || "")}</p>
            <p><span class="detail-label">Occupation :</span> ${escapeHtml(g.immeubleOccupe || "")}</p>
            <p><span class="detail-label">Dates :</span> visite le ${escapeHtml(g.missionDateVisite || "–")} • rapport le ${escapeHtml(g.missionDateRapport || "–")}</p>
            <p><span class="detail-label">Durée / arrivée :</span> ${escapeHtml(g.missionDuree || "–")} • arrivée ${escapeHtml(g.missionArrivee || "–")}</p>
          </div>
        </div>

        <div class="detail-block">
          <h3>Donneur d'ordre</h3>
          <div class="detail-list">
            <p><span class="detail-label">Nom :</span> ${escapeHtml(g.donorName || "")}</p>
            <p><span class="detail-label">Type :</span> ${escapeHtml(g.donorType || "")}</p>
            <p><span class="detail-label">Adresse :</span> ${escapeHtml(g.donorAdresse || "")} ${escapeHtml(g.donorCP || "")} ${escapeHtml(g.donorCommune || "")}</p>
          </div>
        </div>

        <div class="detail-block">
          <h3>Propriétaire</h3>
          <div class="detail-list">
            <p><span class="detail-label">Nom :</span> ${escapeHtml(g.propName || "")}</p>
            <p><span class="detail-label">Adresse :</span> ${escapeHtml(g.propAdresse || "")} ${escapeHtml(g.propCP || "")} ${escapeHtml(g.propCommune || "")}</p>
          </div>
        </div>
      </div>

      <div>
        <div class="detail-block">
          <h3>Adresse du bien</h3>
          <div class="detail-list">
            <p><span class="detail-label">Adresse :</span> ${escapeHtml(g.immeubleAdresse1 || "")}</p>
            <p><span class="detail-label">Ville :</span> ${escapeHtml(g.immeubleCP || "")} ${escapeHtml(g.immeubleCommune || "")}</p>
            <p><span class="detail-label">Loc. copro / bâtiment :</span> ${escapeHtml(g.immeubleLocCopro || "")}</p>
            <p><span class="detail-label">Description :</span> ${escapeHtml(g.immeubleDescription || "")}</p>
          </div>
        </div>

        <div class="detail-block">
          <h3>Diagnostiqueur</h3>
          <div class="detail-list">
            <p><span class="detail-label">Nom :</span> ${escapeHtml(g.diagNom || "")} (${escapeHtml(g.diagInitiales || "")})</p>
            <p><span class="detail-label">Certification :</span> ${escapeHtml(g.diagCertSociete || "")} – ${escapeHtml(g.diagCertNum || "")}</p>
            <p><span class="detail-label">Validité :</span> ${escapeHtml(g.diagCertDate || "")}</p>
            <p><span class="detail-label">Version logiciel :</span> ${escapeHtml(g.versionLogiciel || "")}</p>
          </div>
        </div>

        ${domainsHtml}

        <div class="detail-block">
          <h3>Description générale</h3>
          <div class="detail-list">
            ${descriptionParts.join("") || "<p>Aucune description générale disponible.</p>"}
          </div>
        </div>
      </div>
    </div>

    <div class="detail-block" style="margin-top:10px;">
      <h3>Notes et mémos</h3>
      <div class="detail-list">
        <p><span class="detail-label">Mémo terrain :</span> ${escapeHtml(g.missionMemoTerrain || "")}</p>
        <p><span class="detail-label">Notes libres :</span> ${escapeHtml(g.missionNotes || "")}</p>
      </div>
    </div>

    <div class="detail-block" id="photosBlock" style="${mission.photos && mission.photos.length ? "" : "display:none;"}">
      <h3>Photos générales (${mission.photos.length})</h3>
      <div class="photos-grid" id="photosGrid"></div>
    </div>
  `;

  card.style.display = "block";

  if (mission.photos && mission.photos.length) {
    loadMissionPhotosThumbnails(mission).catch(err => {
      console.error("Erreur chargement photos:", err);
    });
  }
}

async function loadMissionPhotosThumbnails(mission) {
  const grid = document.getElementById("photosGrid");
  if (!grid) return;
  grid.innerHTML = "";

  const maxPhotos = Math.min(mission.photos.length, 8);
  for (let i = 0; i < maxPhotos; i++) {
    const p = mission.photos[i];
    const thumb = document.createElement("div");
    thumb.className = "photo-thumb";
    thumb.innerHTML = `<span>${escapeHtml(p.localisation || p.description || p.prestation || p.codePhoto || "")}</span>`;
    grid.appendChild(thumb);

    if (!p.cheminAcces) continue;

    try {
      const url = await resolvePhotoUrl(mission.dirHandle, p.cheminAcces);
      const img = document.createElement("img");
      img.src = url;
      thumb.insertBefore(img, thumb.firstChild);
    } catch (e) {
      console.warn("Photo introuvable pour", p.cheminAcces, e);
    }
  }
}

async function resolvePhotoUrl(missionDirHandle, cheminAcces) {
  const norm = cheminAcces.replace(/\\/g, "/").replace(/\\/g, "/");
  const parts = norm.split("/").filter(Boolean);
  if (!parts.length) throw new Error("Chemin vide");
  let dir = missionDirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i];
    dir = await dir.getDirectoryHandle(seg);
  }
  const fileHandle = await dir.getFileHandle(parts[parts.length - 1]);
  const file = await fileHandle.getFile();
  return URL.createObjectURL(file);
}

// ========= Utilitaire escape =========
function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

// ========= Initialisation =========
document.getElementById("pickRootBtn").addEventListener("click", async () => {
  try {
    const root = await window.showDirectoryPicker();
    rootHandle = root;
    document.getElementById("rootInfo").textContent = "Dossier racine : " + root.name;
    document.getElementById("scanStatus").textContent = "Scan des missions en cours...";
    document.getElementById("scanStatus").className = "status";

    allMissions = await scanRootDirectory(rootHandle);

    if (!allMissions.length) {
      document.getElementById("scanStatus").textContent = "Aucune mission LICIEL détectée dans ce dossier.";
      document.getElementById("scanStatus").className = "status error";
      document.getElementById("filtersCard").style.display = "none";
      document.getElementById("missionsCard").style.display = "none";
      document.getElementById("detailCard").style.display = "none";
      return;
    }

    document.getElementById("scanStatus").textContent = `${allMissions.length} mission(s) détectée(s).`;
    document.getElementById("scanStatus").className = "status ok";

    filterIndex = buildFilterIndex(allMissions);
    updateFilterButtonsCounts();
    document.getElementById("filtersCard").style.display = "block";
    renderMissionsTable(allMissions);
  } catch (e) {
    console.error(e);
    document.getElementById("scanStatus").textContent = "Erreur lors du choix du dossier ou du scan.";
    document.getElementById("scanStatus").className = "status error";
  }
});

document.querySelectorAll(".filter-dimension").forEach(btn => {
  btn.addEventListener("click", () => {
    if (!filterIndex) return;
    document.querySelectorAll(".filter-dimension").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const dim = btn.dataset.dim;
    currentFilterDim = dim;
    renderFilterValues(dim);
  });
});
