import json
import re
from pathlib import Path
from typing import Dict, List, Tuple

XML_SOURCES: Tuple[str, ...] = (
    "Table_Z_Amiante.xml",
    "Table_Z_Amiante_prelevements.xml",
    "Table_Z_Amiante_General.xml",
    "Table_Z_Amiante_Ecart_Norme.xml",
    "Table_Z_Amiante_doc_remis.xml",
    "Table_General_Amiante_Analyses.xml",
)


def load_text(path: str) -> str:
    file_path = Path(path)
    return file_path.read_text(errors="ignore") if file_path.exists() else ""


def clean_value(val: str) -> str:
    return re.sub(r"\s+", " ", val).strip()


def detect_item_tag(text: str) -> str | None:
    match = re.search(r"<(LiItem_[^>\s]+)>", text, re.IGNORECASE)
    return match.group(1) if match else None


def parse_items(blocks: List[str]) -> List[Dict[str, str]]:
    reg = re.compile(r"<([^/>]+)>([\s\S]*?)</\1>")
    items: List[Dict[str, str]] = []
    for block in blocks:
        obj: Dict[str, str] = {}
        for tag, val in reg.findall(block):
            obj[tag] = clean_value(val)
            if tag.startswith("LiColonne_"):
                obj[tag.replace("LiColonne_", "")] = obj[tag]
        if obj:
            items.append(obj)
    return items


def parse_flat(text: str) -> Dict[str, str]:
    reg = re.compile(r"<([^/>]+)>([\s\S]*?)</\1>")
    obj: Dict[str, str] = {}
    for tag, val in reg.findall(text):
        obj[tag] = clean_value(val)
    return obj


def parse_xml_file(path: str) -> Dict:
    text = load_text(path)
    if not text:
        return {"meta": {"source": path, "error": "Fichier introuvable"}}

    item_tag = detect_item_tag(text)
    if item_tag:
        pattern = re.compile(fr"<{item_tag}>([\s\S]*?)</{item_tag}>", re.IGNORECASE)
        blocks = pattern.findall(text)
        items = parse_items(blocks)
        return {
            "items": items,
            "meta": {
                "source": path,
                "type": "collection",
                "itemTag": item_tag,
                "count": len(items),
            },
        }

    flat = parse_flat(text)
    return {
        "data": flat,
        "meta": {
            "source": path,
            "type": "flat",
            "count": len(flat),
        },
    }


def write_json(target: Path, payload: Dict) -> None:
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"Saved {target} ({payload.get('meta', {}).get('count', 0)} entrées)")


def build_amiante_payload(parsed_files: Dict[str, Dict]) -> Dict:
    materiaux = parsed_files.get("Table_Z_Amiante.xml", {}).get("items", [])
    prelevements = parsed_files.get("Table_Z_Amiante_prelevements.xml", {}).get("items", [])
    general_info = parsed_files.get("Table_Z_Amiante_General.xml", {}).get("data", {})

    rows = []
    for mat in materiaux:
        num_mat = (mat.get("Num_Materiau") or mat.get("Reperage_3") or mat.get("Id_Prelevement_Int_txt") or "").strip()
        related_prels = [p for p in prelevements if (p.get("Num_Materiau") or "").strip() == num_mat]
        pre_ids = [p.get("Num_Prelevement") for p in related_prels if p.get("Num_Prelevement")]
        resultat = mat.get("Resultats") or (related_prels[0].get("Resultat_reperage") if related_prels else "")

        row = {
            "Nom_EI": general_info.get("LiColonne_Immeuble_Adresse1") or "Adresse non précisée",
            "Num_UG": general_info.get("LiColonne_Gen_Num_rapport") or general_info.get("LiColonne_Gen_Num_mission") or "UG",
            "Commune": general_info.get("LiColonne_Immeuble_Commune", ""),
            "Local_visite": mat.get("Localisation") or mat.get("Detail_loc") or "",
            "Etage": general_info.get("LiColonne_Loc_Etage", ""),
            "occupation": "",
            "date_realisation": general_info.get("LiColonne_Gen_Date_rapport", ""),
            "operateur": general_info.get("LiColonne_Gen_Nom_operateur", ""),
            "reference_rapport": general_info.get("LiColonne_Gen_Num_rapport") or mat.get("Dossier_Materiau", ""),
            "composant_construction": mat.get("Ouvrages", ""),
            "materiau_produit": mat.get("Description") or mat.get("Partie_Inspectee") or "",
            "num_prelevement": mat.get("num_prelevement") or "; ".join([p for p in pre_ids if p]),
            "resultat": resultat,
            "applicabilite_ZPSO": mat.get("Id_Prelevement") or "",
            "etat_conservation": mat.get("Etat_Conservation", ""),
            "quantite": mat.get("quantite", ""),
            "unité": mat.get("unite", ""),
            "resultat_Hap": mat.get("resultat_Hap", ""),
        }
        rows.append(row)

    return {
        "rows": rows,
        "meta": {
            "generatedFrom": "xml",
            "sources": [
                "Table_Z_Amiante.xml",
                "Table_Z_Amiante_prelevements.xml",
                "Table_Z_Amiante_General.xml",
            ],
            "count": len(rows),
        },
    }


def main():
    parsed_files: Dict[str, Dict] = {}

    for source in XML_SOURCES:
        parsed = parse_xml_file(source)
        parsed_files[source] = parsed
        write_json(Path(source).with_suffix(".json"), parsed)

    amiante_payload = build_amiante_payload(parsed_files)
    for target in ("amiante_auto.json", "generate_amiante_json.json"):
        write_json(Path(target), amiante_payload)


if __name__ == "__main__":
    main()
