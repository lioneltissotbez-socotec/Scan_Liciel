//--------------------------------------------------
// UTIL : lecture multi-encodage 
//--------------------------------------------------
async function readFileCorrectly(fileHandle){
    const file = await fileHandle.getFile();
    const buf = await file.arrayBuffer();

    const decoders=["utf-8","iso-8859-1","windows-1252"];

    for(const enc of decoders){
        try{
            return new TextDecoder(enc,{fatal:true}).decode(buf);
        }catch(e){}
    }
    return new TextDecoder("utf-8").decode(buf);
}

//--------------------------------------------------
// CLICK : Choisir dossier racine 
//--------------------------------------------------
document.getElementById("pickRoot").addEventListener("click", async ()=>{
    const root = await window.showDirectoryPicker();
    document.getElementById("rootName").innerText = "📁 " + root.name;

    const missions = await scanRoot(root);
    renderMissionList(missions);
});

//--------------------------------------------------
// SCAN du dossier racine
//--------------------------------------------------
async function scanRoot(rootHandle){
    const missions = [];

    for await (const [name, handle] of rootHandle.entries()){
        if(handle.kind==="directory"){
            const parsed = await parseMissionFolder(handle, name);
            if(parsed){
                missions.push(parsed);
            }
        }
    }
    return missions;
}

//--------------------------------------------------
// PARSE D'UNE MISSION LICIEL
//--------------------------------------------------
async function parseMissionFolder(dirHandle, label){
    let xmlDir = null;

    // On cherche le sous-dossier XML
    for await (const [name, handle] of dirHandle.entries()){
        if(handle.kind==="directory" && name.toLowerCase()==="xml"){
            xmlDir = handle;
            break;
        }
    }

    const targetDir = xmlDir || dirHandle;

    let generalText=null, amianteText=null, crepText=null;

    for await (const [name, handle] of targetDir.entries()){
        if(handle.kind!=="file") continue;
        const lower=name.toLowerCase();

        if(lower==="table_general_bien.xml"){
            generalText = await readFileCorrectly(handle);
        }
        else if(lower==="table_z_amiante.xml"){
            amianteText = await readFileCorrectly(handle);
        }
        else if(lower==="table_z_crep.xml"){
            crepText = await readFileCorrectly(handle);
        }
    }

    if(!generalText) return null;

    return {
        id: label,
        label,
        general: parseGeneral(generalText),
        amiante: amianteText ? parseAmiante(amianteText) : null,
        crep: crepText ? parseCrep(crepText) : null
    };
}

//--------------------------------------------------
// PARSE : Table_General_Bien
//--------------------------------------------------
function parseGeneral(text){
    text = text.replace(/[\u0000-\u001F]+/g," ");

    const xml = new DOMParser().parseFromString(text,"text/xml");
    const root = xml.documentElement;

    const sections = {
        donneur_ordre:{},
        proprietaire:{},
        locataire:{},
        immeuble:{},
        mission:{},
        operateur:{},
        autres:{}
    };

    [...root.children].forEach(node=>{
        const tag=node.tagName;
        const val=node.textContent.trim();

        if(tag.includes("_DOrdre_")) sections.donneur_ordre[tag]=val;
        else if(tag.includes("_Prop_")) sections.proprietaire[tag]=val;
        else if(tag.includes("_LOC_") || tag.includes("_Loc_")) sections.locataire[tag]=val;
        else if(tag.includes("_Immeuble_")) sections.immeuble[tag]=val;
        else if(tag.includes("_Mission_")) sections.mission[tag]=val;
        else if(tag.includes("_Gen_") || tag.toLowerCase().includes("operateur")) sections.operateur[tag]=val;
        else sections.autres[tag]=val;
    });

    return sections;
}

//--------------------------------------------------
// PARSE : Table_Z_Amiante
//--------------------------------------------------
function parseAmiante(text){
    text = text.replace(/[\u0000-\u001F]+/g," ");

    const xml = new DOMParser().parseFromString("<root>"+text+"</root>","text/xml");
    const rows = [...xml.getElementsByTagName("*")].filter(n=>n.tagName.startsWith("LiItem_table_Z_Amiante"));
    const items = rows.map(item=>{
        const o={};
        [...item.children].forEach(c=>o[c.tagName]=c.textContent.trim());
        return o;
    });

    return items;
}

//--------------------------------------------------
// PARSE : Table_Z_CREP
//--------------------------------------------------
function parseCrep(text){
    text = text.replace(/[\u0000-\u001F]+/g," ");

    const xml = new DOMParser().parseFromString("<root>"+text+"</root>","text/xml");
    const rows = [...xml.getElementsByTagName("*")].filter(n=>n.tagName.startsWith("LiItem_table_Z_CREP"));
    const items = rows.map(item=>{
        const o={};
        [...item.children].forEach(c=>o[c.tagName]=c.textContent.trim());
        return o;
    });

    return items;
}

//--------------------------------------------------
// RENDER : Liste des missions trouvées
//--------------------------------------------------
function renderMissionList(missions){
    const cont=document.getElementById("missionList");
    cont.innerHTML="";

    missions.forEach(m=>{
        const btn=document.createElement("div");
        btn.className="mission-btn";
        btn.textContent = m.label;
        btn.addEventListener("click",()=>showMissionDetail(m));
        cont.appendChild(btn);
    });

    document.getElementById("missionsCard").style.display="block";
}

//--------------------------------------------------
// RENDER : Detail d'une mission
//--------------------------------------------------
function showMissionDetail(m){
    const box=document.getElementById("detailContent");
    box.innerHTML="";

    function tableFromObj(title,obj){
        let html = "<div class='section'><h3>"+title+"</h3>";
        html += "<table><tbody>";

        for(const [k,v] of Object.entries(obj)){
            html += "<tr><th>"+k+"</th><td>"+v+"</td></tr>";
        }
        html += "</tbody></table></div>";
        return html;
    }

    box.innerHTML += tableFromObj("Donneur d'ordre", m.general.donneur_ordre);
    box.innerHTML += tableFromObj("Propriétaire", m.general.proprietaire);
    box.innerHTML += tableFromObj("Locataire", m.general.locataire);
    box.innerHTML += tableFromObj("Immeuble", m.general.immeuble);
    box.innerHTML += tableFromObj("Mission", m.general.mission);
    box.innerHTML += tableFromObj("Opérateur", m.general.operateur);

    if(m.amiante){
        box.innerHTML += "<div class='section'><h3>Amiante - Items ZPSO</h3>";
        box.innerHTML += buildTableAmiante(m.amiante);
        box.innerHTML += "</div>";
    }

    if(m.crep){
        box.innerHTML += "<div class='section'><h3>CREP - Items</h3>";
        box.innerHTML += buildTableCrep(m.crep);
        box.innerHTML += "</div>";
    }

    document.getElementById("detailCard").style.display="block";
}

function buildTableAmiante(items){
    if(!items.length) return "<p>Aucune donnée</p>";

    const cols=[...new Set(items.flatMap(r=>Object.keys(r)))];

    let html="<table><thead><tr>";
    cols.forEach(c=>html+="<th>"+c+"</th>");
    html+="</tr></thead><tbody>";

    items.forEach(it=>{
        html+="<tr>";
        cols.forEach(c=>html+="<td>"+(it[c]||"")+"</td>");
        html+="</tr>";
    });

    html+="</tbody></table>";
    return html;
}

function buildTableCrep(items){
    if(!items.length) return "<p>Aucune donnée</p>";

    const cols=[...new Set(items.flatMap(r=>Object.keys(r)))];

    let html="<table><thead><tr>";
    cols.forEach(c=>html+="<th>"+c+"</th>");
    html+="</tr></thead><tbody>";

    items.forEach(it=>{
        html+="<tr>";
        cols.forEach(c=>html+="<td>"+(it[c]||"")+"</td>");
        html+="</tr>";
    });

    html+="</tbody></table>";
    return html;
}
