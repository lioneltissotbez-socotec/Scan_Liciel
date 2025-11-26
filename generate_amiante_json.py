import json
import re
from pathlib import Path

def parse_items(text, item_tag):
    pattern = re.compile(fr'<{item_tag}>([\s\S]*?)</{item_tag}>', re.IGNORECASE)
    reg = re.compile(r'<([^/>]+)>([\s\S]*?)</\1>')
    items = []
    for block in pattern.findall(text):
        obj = {}
        for tag, val in reg.findall(block):
            clean_val = re.sub(r"\s+", " ", val).strip()
            obj[tag] = clean_val
            if tag.startswith("LiColonne_"):
                obj[tag.replace("LiColonne_", "")] = clean_val
        items.append(obj)
    return items

def parse_colonnes(text):
    reg = re.compile(r'<LiColonne_([^>]+)>([\s\S]*?)</LiColonne_\1>', re.IGNORECASE)
    obj = {}
    for key, val in reg.findall(text):
        obj[f"LiColonne_{key}"] = re.sub(r"\s+", " ", val).strip()
    return obj

def load_text(path):
    return Path(path).read_text(errors="ignore") if Path(path).exists() else ""

materiaux_text = load_text('Table_Z_Amiante.xml')
prelevements_text = load_text('Table_Z_Amiante_prelevements.xml')
general_text = load_text('Table_Z_Amiante_General.xml')

materiaux = parse_items(materiaux_text, 'LiItem_table_Z_Amiante')
prelevements = parse_items(prelevements_text, 'LiItem_table_Z_Amiante_prelevements')
general_info = parse_colonnes(general_text)

rows = []
for mat in materiaux:
    num_mat = mat.get('Num_Materiau') or mat.get('Reperage_3') or mat.get('Id_Prelevement_Int_txt') or ''
    related_prels = [p for p in prelevements if (p.get('Num_Materiau') or '').strip() == num_mat.strip()]
    pre_ids = [p.get('Num_Prelevement') for p in related_prels if p.get('Num_Prelevement')]
    resultat = mat.get('Resultats') or (related_prels[0].get('Resultat_reperage') if related_prels else '')
    row = {
        "Nom_EI": general_info.get('LiColonne_Immeuble_Adresse1') or "Adresse non précisée",
        "Num_UG": general_info.get('LiColonne_Gen_Num_rapport') or general_info.get('LiColonne_Gen_Num_mission') or "UG",
        "Commune": general_info.get('LiColonne_Immeuble_Commune', ''),
        "Local_visite": mat.get('Localisation') or mat.get('Detail_loc') or '',
        "Etage": general_info.get('LiColonne_Loc_Etage', ''),
        "occupation": "",
        "date_realisation": general_info.get('LiColonne_Gen_Date_rapport', ''),
        "operateur": general_info.get('LiColonne_Gen_Nom_operateur', ''),
        "reference_rapport": general_info.get('LiColonne_Gen_Num_rapport') or mat.get('Dossier_Materiau', ''),
        "composant_construction": mat.get('Ouvrages', ''),
        "materiau_produit": mat.get('Description') or mat.get('Partie_Inspectee') or '',
        "num_prelevement": mat.get('num_prelevement') or "; ".join(pre_ids),
        "resultat": resultat,
        "applicabilite_ZPSO": mat.get('Id_Prelevement') or '',
        "etat_conservation": mat.get('Etat_Conservation', ''),
        "quantite": mat.get('quantite', ''),
        "unité": mat.get('unite', ''),
        "resultat_Hap": mat.get('resultat_Hap', '')
    }
    rows.append(row)

payload = {"rows": rows, "meta": {"generatedFrom": "xml", "sources": ["Table_Z_Amiante.xml", "Table_Z_Amiante_prelevements.xml", "Table_Z_Amiante_General.xml"]}}

json_text = json.dumps(payload, ensure_ascii=False, indent=2)

for target in ("amiante_auto.json", "generate_amiante_json.json"):
    Path(target).write_text(json_text)
    print(f"Generated {len(rows)} rows in {target}")
