const HEADERS = [
  "Num_EI",
  "Nom_EI",
  "Num_UG",
  "Commune",
  "Local_visite",
  "Etage",
  "occupation",
  "date_realisation",
  "operateur",
  "reference_rapport",
  "composant_construction",
  "materiau_produit",
  "num_prelevement",
  "resultat",
  "applicabilite_ZPSO",
  "etat_conservation",
  "quantite",
  "unité",
  "resultat_Hap"
];

const FILTERS = [
  { key: "donneur", label: "Donneur d'ordre" },
  { key: "proprietaire", label: "Propriétaire" },
  { key: "diagnostiqueur", label: "Diagnostiqueur" },
  { key: "ville", label: "Ville" },
  { key: "rue", label: "Rue" },
];

const MISSION_TYPES = {
  amiante: "Amiante",
  plomb: "Plomb",
  electricite: "Électricité",
  gaz: "Gaz",
  dpe: "DPE",
  mesurage: "Mesurage Carrez",
  parasites: "Parasites",
  termites: "Termites"
};

let missions = [];
let currentFilterType = null;
let currentFilterValue = null;
let selectedTypes = new Set();

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("pickParent").addEventListener("click", handlePickParent);
  document.getElementById("exportJson").addEventListener("click", exportFilteredToSynthese);
  document.getElementById("copyJson").addEventListener("click", copyJson);
  renderFilterButtons();
});

async function handlePickParent() {
  const status = document.getElementById("status");
  try {
    const parent = await window.showDirectoryPicker();
    document.getElementById("parentInfo").textContent = `📁 ${parent.name}`;
    status.textContent = "Analyse des sous-dossiers en cours…";

    missions = await scanParentDirectory(parent);
    currentFilterType = null;
    currentFilterValue = null;
    selectedTypes.clear();

    renderFilterButtons();
    renderFilterValues();
    renderTypeFilters();
    renderMissionsTable();
    renderAmiantePreview();

    status.textContent = missions.length
      ? `✔ ${missions.length} mission(s) analysée(s)`
      : "Aucune mission LICIEL valide trouvée";
  } catch (err) {
    console.warn("Sélection annulée ou erreur", err);
  }
}

async function scanParentDirectory(parentHandle) {
  const list = [];
  for await (const [name, handle] of parentHandle.entries()) {
    if (handle.kind !== "directory") continue;
    const mission = await parseMission(handle, name);
    if (mission) list.push(mission);
  }
  return list;
}

async function parseMission(dirHandle, label) {
  let xmlDir = null;
  for await (const [subName, subHandle] of dirHandle.entries()) {
    if (subHandle.kind === "directory" && subName.toLowerCase() === "xml") {
      xmlDir = subHandle;
      break;
    }
  }
  if (!xmlDir) return null;

  const files = await listXmlFiles(xmlDir);
  if (!files.length) return null;

  const generalHandle = files.find(f => f.name.toLowerCase() === "table_general_bien.xml");
  const amianteHandle = files.find(f => {
    const low = f.name.toLowerCase();
    return low === "table_amiante.xml" || low === "table_z_amiante.xml";
  });
  const prelevHandle = files.find(f => {
    const low = f.name.toLowerCase();
    return low === "table_amiante_prelevements.xml" || low === "table_z_amiante_prelevements.xml";
  });

  if (!generalHandle) return null;

  const generalText = await readFileCorrectly(generalHandle.handle);
  const general = parseGeneral(generalText);

  const missionTypes = detectMissionTypes(files);
  const amianteRows = amianteHandle
    ? await parseAmiante(amianteHandle.handle, prelevHandle?.handle, general.raw)
    : [];

  if (amianteRows.length && !missionTypes.includes(MISSION_TYPES.amiante)) {
    missionTypes.push(MISSION_TYPES.amiante);
  }

  return {
    id: label,
    label,
    general,
    missionTypes,
    amianteRows,
  };
}

async function listXmlFiles(dirHandle) {
  const list = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === "file") list.push({ name, handle });
  }
  return list;
}

async function readFileCorrectly(fileHandle) {
  const file = await fileHandle.getFile();
  const buffer = await file.arrayBuffer();
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); } catch (e) {}
  try { return new TextDecoder("iso-8859-1").decode(buffer); } catch (e) {}
  return new TextDecoder("windows-1252").decode(buffer);
}

function parseXml(str) {
  return new DOMParser().parseFromString(str, "text/xml");
}

function cleanText(str) {
  if (!str) return "";
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").replace(/\s+/g, " ").trim();
}

function getTag(el, tag) {
  const n = el.getElementsByTagName(tag)[0];
  return cleanText(n ? n.textContent : "");
}

function parseGeneral(xmlText) {
  const xml = parseXml(xmlText);
  const node = xml.getElementsByTagName("LiTable_General_Bien")[0] || xml.documentElement;

  const general = {
    raw: node,
    donneur: getTag(node, "LiColonne_DOrdre_Nom"),
    proprietaire: getTag(node, "LiColonne_Prop_Nom"),
    diagnostiqueur: getTag(node, "LiColonne_Gen_Nom_operateur"),
    ville: getTag(node, "LiColonne_Immeuble_Commune"),
    rue: getTag(node, "LiColonne_Immeuble_Adresse1"),
    numEI: getTag(node, "LiColonne_Immeuble_Loc_copro"),
    nomEI: getTag(node, "LiColonne_Immeuble_Adresse1"),
    numUG: getTag(node, "LiColonne_Immeuble_Lot"),
    occupation: getTag(node, "LiColonne_Immeuble_Occupe_vide"),
    dateVisite: getTag(node, "LiColonne_Mission_Date_Visite"),
    operateur: getTag(node, "LiColonne_Gen_Nom_operateur"),
    reference: getTag(node, "LiColonne_Mission_Num_Dossier")
  };
  return general;
}

async function parseAmiante(amianteHandle, prelevHandle, generalRaw) {
  const textZ = await readFileCorrectly(amianteHandle);
  const xmlZ = parseXml(textZ);

  let prelevMap = {};
  if (prelevHandle) {
    const textP = await readFileCorrectly(prelevHandle);
    const xmlP = parseXml(textP);
    const items = [...xmlP.getElementsByTagName("*")].filter(n => /LiItem_table_(Z_)?Amiante_prelevements/i.test(n.tagName));
    items.forEach(it => {
      const zpso = getTag(it, "LiColonne_Data_02") || getTag(it, "LiColonne_id_zspo");
      const prl = getTag(it, "LiColonne_Data_01") || getTag(it, "LiColonne_num_prelevement");
      if (!zpso || !prl) return;
      if (!prelevMap[zpso]) prelevMap[zpso] = [];
      prelevMap[zpso].push(prl);
    });
  }

  const generalNode = generalRaw || {};
  const Num_EI = cleanText(generalNode.getElementsByTagName ? getTag(generalNode, "LiColonne_Immeuble_Loc_copro") : "");
  const Nom_EI = cleanText(generalNode.getElementsByTagName ? getTag(generalNode, "LiColonne_Immeuble_Adresse1") : "");
  const Num_UG = cleanText(generalNode.getElementsByTagName ? getTag(generalNode, "LiColonne_Immeuble_Lot") : "");
  const Commune = cleanText(generalNode.getElementsByTagName ? getTag(generalNode, "LiColonne_Immeuble_Commune") : "");
  const occupation = cleanText(generalNode.getElementsByTagName ? getTag(generalNode, "LiColonne_Immeuble_Occupe_vide") : "");
  const date_realisation = cleanText(generalNode.getElementsByTagName ? getTag(generalNode, "LiColonne_Mission_Date_Visite") : "");
  const opNom = cleanText(generalNode.getElementsByTagName ? getTag(generalNode, "LiColonne_Gen_Nom_operateur") : "");
  const operateur = opNom ? `SOCOTEC ${opNom}` : "";
  const reference = cleanText(generalNode.getElementsByTagName ? getTag(generalNode, "LiColonne_Mission_Num_Dossier") : "");

  const items = [...xmlZ.getElementsByTagName("*")]
    .filter(n => /LiItem_table_(Z_)?Amiante(?!_prelevements)/i.test(n.tagName));
  const rows = [];

  items.forEach(it => {
    const zpso = getTag(it, "LiColonne_Id_Prelevement");
    const mat = getTag(it, "LiColonne_Description");
    const comp = getTag(it, "LiColonne_Ouvrages");
    const result = getTag(it, "LiColonne_Resultats");
    const etat = getTag(it, "LiColonne_Etat_Conservation");
    const loc = getTag(it, "LiColonne_Detail_loc");
    const qty = getTag(it, "LiColonne_SurfaceMateriau");
    const unit = getTag(it, "LiColonne_SurfaceMateriauUnite");

    let prl = [];
    const raw = getTag(it, "LiColonne_num_prelevement");
    if (raw) {
      prl = raw.split(";").map(s => cleanText(s)).filter(Boolean);
    } else if (prelevMap[zpso]) {
      prl = [...prelevMap[zpso]];
    }

    const numPrel = buildNumPrelevements(prl, loc);
    rows.push({
      Num_EI,
      Nom_EI,
      Num_UG,
      Commune,
      Local_visite: loc,
      Etage: getEtage(loc),
      occupation,
      date_realisation,
      operateur,
      reference_rapport: reference,
      composant_construction: comp,
      materiau_produit: mat,
      num_prelevement: numPrel,
      resultat: result,
      applicabilite_ZPSO: zpso,
      etat_conservation: etat,
      quantite: qty,
      unité: unit,
      resultat_Hap: "",
    });
  });

  return rows;
}

function buildNumPrelevements(list, loc) {
  if (!list || !list.length) return "";
  const parts = (loc || "").split(";").map(s => cleanText(s)).filter(Boolean);
  if (parts.length === list.length) {
    return list.map((p, i) => `${p} (${parts[i]})`).join(";");
  }
  const last = parts[parts.length - 1] || "";
  return list.map((p, i) => `${p} (${parts[i] || last})`).join(";");
}

function getEtage(loc) {
  const first = (loc || "").split(";")[0];
  return cleanText(first.split("-")[0]);
}

function detectMissionTypes(files = []) {
  const detected = new Set();
  files.forEach(({ name }) => {
    const low = name.toLowerCase();
    if (low.includes("amiante")) detected.add(MISSION_TYPES.amiante);
    if (low.includes("crep")) detected.add(MISSION_TYPES.plomb);
    if (low.includes("elec")) detected.add(MISSION_TYPES.electricite);
    if (low.includes("gaz")) detected.add(MISSION_TYPES.gaz);
    if (low.includes("dpe")) detected.add(MISSION_TYPES.dpe);
    if (low.includes("carrez")) detected.add(MISSION_TYPES.mesurage);
    if (low.includes("parasite")) detected.add(MISSION_TYPES.parasites);
    if (low.includes("termite")) detected.add(MISSION_TYPES.termites);
  });
  return Array.from(detected);
}

function getField(mission, type) {
  const g = mission.general || {};
  switch (type) {
    case "donneur": return g.donneur || "";
    case "proprietaire": return g.proprietaire || "";
    case "diagnostiqueur": return g.diagnostiqueur || "";
    case "ville": return g.ville || "";
    case "rue": return g.rue || "";
    default: return "";
  }
}

function filteredMissions() {
  let data = missions.slice();
  if (currentFilterType && currentFilterValue !== null) {
    data = data.filter(m => getField(m, currentFilterType) === currentFilterValue);
  }
  if (selectedTypes.size) {
    const required = [...selectedTypes];
    data = data.filter(m => required.every(t => m.missionTypes.includes(t)));
  }
  return data;
}

function renderFilterButtons() {
  const container = document.getElementById("filterButtons");
  container.innerHTML = "";

  FILTERS.forEach(f => {
    const count = new Set(missions.map(m => getField(m, f.key)).filter(Boolean)).size;
    const btn = document.createElement("button");
    btn.className = `filter-btn ${currentFilterType === f.key ? "active" : ""}`;
    btn.type = "button";
    btn.innerHTML = `<span>${f.label}</span><span class="count">${count}</span>`;
    btn.onclick = () => {
      currentFilterType = f.key;
      currentFilterValue = null;
      renderFilterButtons();
      renderFilterValues();
      renderMissionsTable();
      renderAmiantePreview();
    };
    container.appendChild(btn);
  });
}

function renderFilterValues() {
  const block = document.getElementById("filterValuesBlock");
  const valuesContainer = document.getElementById("filterValues");
  const title = document.getElementById("filterValuesTitle");

  if (!currentFilterType) {
    block.style.display = "none";
    return;
  }

  const map = new Map();
  missions.forEach(m => {
    const val = getField(m, currentFilterType);
    if (!val) return;
    map.set(val, (map.get(val) || 0) + 1);
  });
  const entries = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  block.style.display = "block";
  title.textContent = FILTERS.find(f => f.key === currentFilterType)?.label || "Valeurs";
  valuesContainer.innerHTML = "";

  const allButton = document.createElement("div");
  allButton.className = "filter-value-item";
  const btnAll = document.createElement("button");
  btnAll.textContent = "(toutes)";
  btnAll.type = "button";
  btnAll.className = currentFilterValue === null ? "secondary-btn" : "";
  btnAll.onclick = () => {
    currentFilterValue = null;
    renderMissionsTable();
    renderAmiantePreview();
    renderFilterValues();
  };
  const allCount = document.createElement("span");
  allCount.textContent = missions.length;
  allCount.className = "count-pill";
  allButton.append(btnAll, allCount);
  valuesContainer.appendChild(allButton);

  entries.forEach(([val, count]) => {
    const row = document.createElement("div");
    row.className = "filter-value-item";
    const btn = document.createElement("button");
    btn.textContent = val || "(vide)";
    btn.type = "button";
    btn.className = currentFilterValue === val ? "secondary-btn" : "";
    btn.onclick = () => {
      currentFilterValue = val;
      renderMissionsTable();
      renderAmiantePreview();
      renderFilterValues();
    };
    const badge = document.createElement("span");
    badge.textContent = count;
    badge.className = "count-pill";
    row.append(btn, badge);
    valuesContainer.appendChild(row);
  });
}

function renderTypeFilters() {
  const container = document.getElementById("typeFilters");
  container.innerHTML = "";

  Object.values(MISSION_TYPES).forEach(label => {
    const wrapper = document.createElement("label");
    wrapper.className = "chip";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = selectedTypes.has(label);
    input.onchange = () => {
      if (input.checked) selectedTypes.add(label); else selectedTypes.delete(label);
      renderMissionsTable();
      renderAmiantePreview();
    };
    wrapper.append(input, document.createTextNode(label));
    container.appendChild(wrapper);
  });
}

function renderMissionsTable() {
  const wrapper = document.getElementById("missionTableWrapper");
  const data = filteredMissions();
  document.getElementById("missionsCount").textContent = `${data.length} mission(s)`;
  document.getElementById("exportJson").disabled = !data.length || collectRows(data).length === 0;

  if (!data.length) {
    wrapper.innerHTML = "<p class='muted'>Aucune mission ne correspond au filtre.</p>";
    return;
  }

  let html = `
    <table class="mission-table">
      <thead>
        <tr>
          <th>Dossier</th>
          <th>Ville</th>
          <th>Rue</th>
          <th>Donneur d'ordre</th>
          <th>Propriétaire</th>
          <th>Diagnostiqueur</th>
          <th>Types</th>
          <th>Amiante</th>
        </tr>
      </thead>
      <tbody>
  `;

  data.forEach(m => {
    const types = m.missionTypes.length
      ? m.missionTypes.map(t => `<span class="tag">${t}</span>`).join(" ")
      : "<span class='small-muted'>Non détecté</span>";
    const amCount = m.amianteRows.length;
    html += `
      <tr>
        <td>${m.label}</td>
        <td>${m.general.ville || ""}</td>
        <td>${m.general.rue || ""}</td>
        <td>${m.general.donneur || ""}</td>
        <td>${m.general.proprietaire || ""}</td>
        <td>${m.general.diagnostiqueur || ""}</td>
        <td>${types}</td>
        <td>${amCount ? `<span class="status-pill">${amCount} ligne(s)</span>` : '<span class="small-muted">N/A</span>'}</td>
      </tr>
    `;
  });

  html += "</tbody></table>";
  wrapper.innerHTML = html;
}

function collectRows(mList) {
  const rows = [];
  mList.forEach(m => { if (m.amianteRows && m.amianteRows.length) rows.push(...m.amianteRows); });
  return rows;
}

function renderAmiantePreview() {
  const wrapper = document.getElementById("amiantePreview");
  const rows = collectRows(filteredMissions());
  document.getElementById("copyJson").disabled = !rows.length;

  if (!rows.length) {
    wrapper.innerHTML = "<p class='muted'>Aucune ligne amiante disponible.</p>";
    return;
  }

  const head = HEADERS.map(h => `<th>${h}</th>`).join("");
  const body = rows.slice(0, 30).map(r => {
    const tds = HEADERS.map(h => {
      let v = r[h] || "";
      if (h === "resultat" && v) {
        const low = v.toLowerCase();
        let cls = "";
        if (low.includes("présence") || low.includes("presence")) cls = "presence";
        else if (low.includes("suspect")) cls = "suspect";
        else cls = "absence";
        return `<td><span class="tag ${cls}">${v}</span></td>`;
      }
      return `<td>${v}</td>`;
    }).join("");
    return `<tr>${tds}</tr>`;
  }).join("");

  wrapper.innerHTML = `
    <div class="small-muted">${rows.length} ligne(s) prêtes pour la synthèse.</div>
    <table class="preview-table">
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function exportFilteredToSynthese() {
  const list = filteredMissions();
  const rows = collectRows(list);
  if (!rows.length) return;

  const payload = {
    rows,
    tables: null,
    meta: {
      id: "missions-filtrees",
      label: currentFilterType
        ? `${(FILTERS.find(f => f.key === currentFilterType) || {}).label || currentFilterType} : ${currentFilterValue || "toutes"}`
        : `${list.length} mission(s)`,
      createdAt: Date.now(),
      source: "analyse-missions"
    }
  };

  const serialized = JSON.stringify(payload, null, 2);
  const blob = new Blob([serialized], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "synthese_amiante.json";
  a.click();
  URL.revokeObjectURL(url);

  sessionStorage.setItem("amianteAutoRows", serialized);
  localStorage.setItem("amianteAutoRows", serialized);
  alert("JSON généré et stocké pour synthese_amiante.html");
}

function copyJson() {
  const rows = collectRows(filteredMissions());
  if (!rows.length) return;
  const payload = {
    rows,
    tables: null,
    meta: { createdAt: Date.now(), source: "analyse-missions" }
  };
  navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
    .then(() => alert("JSON copié dans le presse-papiers"))
    .catch(err => alert("Impossible de copier : " + err));
}
