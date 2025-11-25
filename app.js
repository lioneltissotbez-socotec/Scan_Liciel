/********************************************************************
 *  INITIALISATION BOUTON
 ********************************************************************/
window.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("pickFolder");
    if (!btn) {
        console.warn("⛔ Bouton #pickFolder introuvable dans le HTML");
        return;
    }

    btn.addEventListener("click", async () => {
        try {
            const rootHandle = await window.showDirectoryPicker();
            document.getElementById("folderName").textContent = "📁 " + rootHandle.name;

            // 🔥 scanne tous les dossiers enfants
            const missions = await scanRootFolder(rootHandle);

            console.log("MISSIONS DÉTECTÉES :", missions);
            window.allMissions = missions;

            renderMissionsTable(missions);
        }
        catch (err) {
            console.error("Erreur de sélection dossier :", err);
            alert("Impossible d’ouvrir le dossier.");
        }
    });
});


/********************************************************************
 *  SCAN DES DOSSIERS LICIEL
 ********************************************************************/

async function readFileCorrectly(fileHandle) {
    const file = await fileHandle.getFile();
    const buffer = await file.arrayBuffer();

    try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); } catch(e){}
    try { return new TextDecoder("iso-8859-1").decode(buffer); } catch(e){}
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

/********************************************************************
 *  PARSE UNE MISSION
 ********************************************************************/
async function parseMissionDirectory(dirHandle, folderName) {
    let general = null;
    let conclusions = null;
    let descGeneral = null;
    let photos = [];
    let domainConclusions = [];

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

        if (lower === "table_general_bien.xml")
            general = parseGeneralBien(await readFileCorrectly(fileHandle));

        else if (lower === "table_general_bien_conclusions.xml")
            conclusions = parseGeneralBienConclusions(await readFileCorrectly(fileHandle));

        else if (lower === "table_general_desciption_general.xml")
            descGeneral = parseGeneralDescription(await readFileCorrectly(fileHandle));

        else if (lower === "table_general_photo.xml")
            photos = parsePhotos(await readFileCorrectly(fileHandle));

        else if (lower === "table_z_conclusions_details.xml")
            domainConclusions = parseZConclusions(await readFileCorrectly(fileHandle));
    }

    if (!general) return null; // pas une mission LICIEL complète

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
 *  PARSE DES TABLES SIMPLES LICIEL
 ********************************************************************/
function parseGeneralBien(xmlText) {
    const xml = new DOMParser().parseFromString(xmlText, "text/xml");
    const root = xml.documentElement;

    const obj = {};
    [...root.children].forEach(n => obj[n.tagName] = n.textContent.trim());
    return obj;
}

function parseGeneralBienConclusions(xmlText) {
    const xml = new DOMParser().parseFromString(xmlText, "text/xml");
    return [...xml.documentElement.children].map(n => {
        const o = {};
        [...n.children].forEach(c => o[c.tagName] = c.textContent.trim());
        return o;
    });
}

function parseGeneralDescription(xmlText) {
    const xml = new DOMParser().parseFromString(xmlText, "text/xml");
    const o = {};
    [...xml.documentElement.children].forEach(n => {
        o[n.tagName] = n.textContent.trim();
    });
    return o;
}

function parsePhotos(xmlText) {
    const xml = new DOMParser().parseFromString(xmlText, "text/xml");
    return [...xml.documentElement.children].map(n => {
        const photo = {};
        [...n.children].forEach(c => photo[c.tagName] = c.textContent.trim());
        return photo;
    });
}

function parseZConclusions(xmlText) {
    const xml = new DOMParser().parseFromString(xmlText, "text/xml");
    return [...xml.documentElement.children].map(n => {
        const o = {};
        [...n.children].forEach(c => o[c.tagName] = c.textContent.trim());
        return o;
    });
}

/********************************************************************
 *  AFFICHAGE LISTE MISSIONS
 ********************************************************************/
function renderMissionsTable(missions) {
    const container = document.getElementById("missionsList");
    let html = "";

    html += `
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

    missions.forEach(m => {
        html += `
        <tr>
            <td>
                <button class="detailBtn" data-id="${m.id}">🔍</button>
            </td>
            <td>${escapeHtml(m.general.LiColonne_Mission_Num_Dossier || "")}</td>
            <td>${escapeHtml(m.general.LiColonne_Immeuble_Adresse1 || "")}</td>
            <td>${escapeHtml(m.general.LiColonne_Immeuble_Commune || "")}</td>
            <td>${escapeHtml(m.general.LiColonne_DOrdre_Nom || "")}</td>
            <td>${escapeHtml(m.general.LiColonne_Prop_Nom || "")}</td>
            <td>${escapeHtml(m.general.LiColonne_Gen_Nom_operateur || "")}</td>
            <td>${escapeHtml(m.general.LiColonne_Mission_Date_Visite || "")}</td>
            <td>${detectDomains(m).join(", ")}</td>
        </tr>`;
    });

    html += "</tbody></table>";
    container.innerHTML = html;

    document.querySelectorAll(".detailBtn").forEach(btn =>
        btn.addEventListener("click", () => showMissionDetail(btn.dataset.id))
    );
}

/********************************************************************
 *  DÉTECTION DES DOMAINES
 ********************************************************************/
function detectDomains(mission) {
    const result = [];

    if (mission.conclusions?.length)
        result.push("Administratif");

    if (mission.domainConclusions?.some(d => d.Etat_Amiante || d.Conclusion_Amiante))
        result.push("Amiante");

    if (mission.domainConclusions?.some(d => d.CREP_Classement))
        result.push("Plomb (CREP)");

    return result;
}

/********************************************************************
 *  DETAIL MISSION (corrigé : affiche seulement domaines présents)
 ********************************************************************/
function showMissionDetail(id) {
    const mission = window.allMissions.find(m => m.id === id);
    if (!mission) return;

    let html = `<h2>Détail mission : ${escapeHtml(id)}</h2>`;

    /* ADMINISTRATIF */
    if (mission.general) {
        html += `<h3>Informations générales</h3><div class="detailBlock">`;
        for (const [k,v] of Object.entries(mission.general))
            if (v && v.trim()) html += `<p><b>${escapeHtml(k)} :</b> ${escapeHtml(v)}</p>`;
        html += `</div>`;
    }

    /* DESCRIPTION */
    if (mission.descGeneral) {
        html += `<h3>Description générale</h3><div class="detailBlock">`;
        for (const [k,v] of Object.entries(mission.descGeneral))
            if (v && v.trim()) html += `<p><b>${escapeHtml(k)} :</b> ${escapeHtml(v)}</p>`;
        html += `</div>`;
    }

    /* CONCLUSIONS ADMIN */
    if (mission.conclusions?.length) {
        const filtered = mission.conclusions.filter(c =>
            Object.values(c).some(v=>v && v.trim())
        );
        if (filtered.length) {
            html += `<h3>Conclusions administratives</h3><div class="detailBlock">`;
            filtered.forEach(c => {
                for (const [k,v] of Object.entries(c))
                    if (v && v.trim()) html += `<p><b>${escapeHtml(k)} :</b> ${escapeHtml(v)}</p>`;
                html += `<hr>`;
            });
            html += `</div>`;
        }
    }

    /* CONCLUSIONS (Amiante / CREP / etc.) */
    const z = mission.domainConclusions?.filter(
        d => Object.values(d).some(v=>v && v.trim())
    );

    if (z?.length) {
        html += `<h3>Conclusions des repérages</h3>`;
        z.forEach(d => {
            html += `<div class="detailBlock">`;
            for (const [k,v] of Object.entries(d))
                if (v && v.trim()) html += `<p><b>${escapeHtml(k)} :</b> ${escapeHtml(v)}</p>`;
            html += `</div>`;
        });
    }

    /* PHOTOS */
    if (mission.photos?.length) {
        html += `<h3>Photographies</h3><div class="photoGrid">`;
        mission.photos.forEach(p => {
            if (p.Photo_Clef) {
                html += `<div class="photoItem">
                    <img src="${p.Photo_Clef}" />
                    <p>${escapeHtml(p.Photo_Commentaire || "")}</p>
                </div>`;
            }
        });
        html += `</div>`;
    }

    document.getElementById("detailPane").innerHTML = html;
}

/********************************************************************
 *  TOOLBOX
 ********************************************************************/
function escapeHtml(str) {
    return (str || "").replace(/[&<>"']/g, c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[c]));
}
