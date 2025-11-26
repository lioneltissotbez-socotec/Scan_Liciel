/**
 * Module Synthèse Amiante
 * Lecture d'un export Excel LICIEL et affichage interactif par ville, adresse et logement.
 */

let groupedData = {};

const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const generateBtn = document.getElementById("generateBtn");

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
