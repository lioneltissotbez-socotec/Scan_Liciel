/************************************************************
 *  Initialisation bouton "Choisir le dossier racine"
 ************************************************************/
window.addEventListener("DOMContentLoaded", () => {

    const rootBtn = document.getElementById("pickRoot");
    if (!rootBtn) {
        console.error("⛔ Bouton #pickRoot introuvable dans la page admin.html");
        return;
    }

    rootBtn.addEventListener("click", async () => {
    try {
        const rootHandle = await window.showDirectoryPicker();

        document.getElementById("rootInfo").textContent =
            "📁 Dossier racine : " + rootHandle.name;

        const missions = await scanRootFolder(rootHandle);
        window.allMissions = missions;

        // --- NOUVEAU ---
        renderFilterButtons();
        renderFilterValues();
        renderMissionsTable();
        // ---------------

    } catch (err) {
        console.warn("Sélection annulée :", err);
    }
});

});

/********************************************************************
 *  ÉTAT GLOBAL
 ********************************************************************/
let allMissions = [];
let currentFilterType = null;   // 'donneur' | 'proprietaire' | ...
let currentFilterValue = null;  // valeur sélectionnée pour le filtre



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
  let descGeneral = null;
  let photos = [];
  let domainConclusions = [];

  // Cherche un sous-dossier "XML"
  let xmlDir = null;
  for await (const [n, h] of dirHandle.entries()) {
    if (h.kind === "directory" && n.toLowerCase() === "xml") {
      xmlDir = h;
      break;
    }
  }
  const target = xmlDir || dirHandle;

  for await (const [fileName, fileHandle] of target.entries()) {
    if (fileHandle.kind !== "file") continue;
    const lower = fileName.toLowerCase();

    if (lower === "table_general_bien.xml") {
      general = parseSingleRowTable(await readFileCorrectly(fileHandle));
    } else if (lower === "table_general_bien_conclusions.xml") {
      conclusions = parseMultiRowTable(await readFileCorrectly(fileHandle));
    } else if (lower === "table_general_desciption_general.xml") {
      descGeneral = parseSingleRowTable(await readFileCorrectly(fileHandle));
    } else if (lower === "table_general_photo.xml") {
      photos = parsePhotoTable(await readFileCorrectly(fileHandle));
    } else if (lower === "table_z_conclusions_details.xml") {
      domainConclusions = parseMultiRowTable(await readFileCorrectly(fileHandle));
    }
  }

  if (!general) return null; // pas une mission LICIEL valide

  return {
    id: folderName,
    label: folderName,
    general,
    conclusions,
    descGeneral,
    photos,
    domainConclusions
  };
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

/********************************************************************
 *  OUTILS ADMIN : GETTERS POUR FILTRES
 ********************************************************************/
function getField(mission, type) {
  const g = mission.general || {};
  switch (type) {
    case "donneur":       return g.LiColonne_DOrdre_Nom || "";
    case "proprietaire":  return g.LiColonne_Prop_Nom || "";
    case "diagnostiqueur":return g.LiColonne_Gen_Nom_operateur || "";
    case "ville":         return g.LiColonne_Immeuble_Commune || "";
    case "rue":           return g.LiColonne_Immeuble_Adresse1 || "";
    case "batiment":      return g.LiColonne_Immeuble_Loc_copro || g.LiColonne_Immeuble_Lot || "";
    default:              return "";
  }
}

const FILTER_TYPES = [
  { key: "donneur",      label: "Donneur d'ordre" },
  { key: "proprietaire", label: "Propriétaire" },
  { key: "diagnostiqueur", label: "Diagnostiqueur" },
  { key: "ville",        label: "Ville" },
  { key: "rue",          label: "Rue" },
  { key: "batiment",     label: "Bâtiment" }
];

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
    // compte le nombre de valeurs distinctes non vides
    const set = new Set();
    allMissions.forEach(m => {
      const v = getField(m, ft.key);
      if (v) set.add(v);
    });
    const distinctCount = set.size;

    // si aucune valeur, on peut soit masquer, soit laisser avec (0)
    if (distinctCount === 0) return; // 👉 on masque ce filtre

    const btn = document.createElement("button");
    btn.className = "filter-btn" + (currentFilterType === ft.key ? " active" : "");
    btn.innerHTML = `
      <span>${ft.label}</span>
      <span class="count">${distinctCount}</span>
    `;
    btn.addEventListener("click", () => {
      if (currentFilterType === ft.key) {
        // si on reclique → on désactive le filtre
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

  // "Tous"
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
  return data;
}

function detectDomains(mission) {
  const result = [];
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

    if (hasAmiante) result.push("Amiante");
    if (hasPlomb) result.push("Plomb");
    if (hasDPE) result.push("DPE");
  }
  return result;
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
      <tr>
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
      showMissionDetail(btn.dataset.id);
    });
  });
}

/********************************************************************
 *  DÉTAIL MISSION ADMINISTRATIF
 ********************************************************************/
function showMissionDetail(id) {
  const mission = allMissions.find(m => m.id === id);
  const pane = document.getElementById("detailPane");
  if (!mission) {
    pane.innerHTML = "<p class='muted'>Mission introuvable.</p>";
    return;
  }

  let html = `<div class="detail-section"><h3>Identité mission</h3>`;
  const g = mission.general || {};
  const idFields = [
    ["Dossier", g.LiColonne_Mission_Num_Dossier],
    ["Donneur d'ordre", g.LiColonne_DOrdre_Nom],
    ["Propriétaire", g.LiColonne_Prop_Nom],
    ["Diagnostiqueur", g.LiColonne_Gen_Nom_operateur],
    ["Date visite", g.LiColonne_Mission_Date_Visite],
    ["Date rapport", g.LiColonne_Mission_Date_Rapport],
    ["Nature du bien", g.LiColonne_Immeuble_Nature_bien],
    ["Type de bien", g.LiColonne_Immeuble_Type_bien],
    ["Type de dossier", g.LiColonne_Immeuble_Type_Dossier],
  ];
  idFields.forEach(([label, val]) => {
    if (val && val.trim()) {
      html += `<p><b>${escapeHtml(label)} :</b> ${escapeHtml(val)}</p>`;
    }
  });
  html += `</div>`;

  html += `<div class="detail-section"><h3>Adresse</h3>`;
  const addrFields = [
    ["Adresse", g.LiColonne_Immeuble_Adresse1],
    ["Complément", g.LiColonne_Immeuble_Description],
    ["Code postal", g.LiColonne_Immeuble_Departement],
    ["Commune", g.LiColonne_Immeuble_Commune],
    ["Lot / Référence interne", g.LiColonne_Immeuble_Lot],
    ["Localisation copro", g.LiColonne_Immeuble_Loc_copro],
  ];
  addrFields.forEach(([label, val]) => {
    if (val && val.trim()) {
      html += `<p><b>${escapeHtml(label)} :</b> ${escapeHtml(val)}</p>`;
    }
  });
  html += `</div>`;

  if (mission.conclusions && mission.conclusions.length) {
    const filled = mission.conclusions.filter(c =>
      Object.values(c).some(v => v && v.trim())
    );
    if (filled.length) {
      html += `<div class="detail-section"><h3>Conclusions administratives</h3>`;
      filled.forEach(c => {
        Object.entries(c).forEach(([k, v]) => {
          if (v && v.trim()) {
            html += `<p><b>${escapeHtml(k)} :</b> ${escapeHtml(v)}</p>`;
          }
        });
        html += `<hr />`;
      });
      html += `</div>`;
    }
  }

  if (mission.domainConclusions && mission.domainConclusions.length) {
    const filtered = mission.domainConclusions.filter(c =>
      Object.values(c).some(v => v && v.trim())
    );
    if (filtered.length) {
      html += `<div class="detail-section"><h3>Conclusions par domaine</h3>`;
      filtered.forEach(c => {
        html += `<div style="margin-bottom:4px;">`;
        Object.entries(c).forEach(([k, v]) => {
          if (v && v.trim()) {
            html += `<p><b>${escapeHtml(k)} :</b> ${escapeHtml(v)}</p>`;
          }
        });
        html += `</div><hr />`;
      });
      html += `</div>`;
    }
  }

  // Photos (miniatures)
  if (mission.photos && mission.photos.length) {
    html += `<div class="detail-section"><h3>Photographies</h3>`;
    mission.photos.forEach(p => {
      const path = p.LiColonne_Photo_Clef || p.Photo_Clef || "";
      const commentaire = p.LiColonne_Photo_Commentaire || p.Photo_Commentaire || "";
      if (!path) return;
      html += `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <img src="${escapeHtml(path)}" alt="" style="width:80px;height:60px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;" />
          <span>${escapeHtml(commentaire)}</span>
        </div>
      `;
    });
    html += `</div>`;
  }

  pane.classList.remove("muted");
  pane.innerHTML = html;
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
