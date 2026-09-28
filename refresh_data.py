#!/usr/bin/env python3
"""Met à jour data/94.json depuis les pages publiques du comité et de la FFVB.

Sources lues : liste des clubs CDVB94, menus de poules, classement HTML,
export CSV du calendrier de poule (bouton public, pas un espace privé).

Jamais : adressier, feuilles de match, licences, saisie des résultats, FSGT, LNV.
"""

from __future__ import annotations

import csv
import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime
from html import unescape
from pathlib import Path

from volley_data import DATA_DIR, LEVEL_HELP, PARIS, compact

USER_AGENT = "volley-app/0.1 (consultation personnelle des pages publiques)"
ALLOWED_HOSTS = {"cdvb94.fr", "www.ffvbbeach.org"}
FORBIDDEN = (
    "saisie_resu",
    "acces_licences",
    "adressier",
    "ffvolley_fdme",
    "fiche_match",
    "extranet",
    "webcoach",
    "webcca",
    "fsgt",
    "lnv.fr",
    "scorenco",
)

DEPARTMENT = {
    "code": "94",
    "name": "Val-de-Marne",
    "committee_name": "Comité départemental de volley-ball du Val-de-Marne",
    "committee_url": "https://cdvb94.fr/",
    "clubs_url": "https://cdvb94.fr/la-pratique/liste-des-clubs/",
    "results_url": "https://cdvb94.fr/resultats/",
    "ffvb_entity": "PTIDF94",
    "league_entity": "LIIDF",
    "output": "94.json",
}

FEATURED = {
    "id": "0946822",
    "name": "Association sportive amicale Maisons-Alfort",
    "short_name": "ASA VB MA",
    "city": "Maisons-Alfort",
    "note": (
        "Nom public : Association sportive amicale Maisons-Alfort (ASA VB MA). "
        "Dans les compétitions, le club s’écrit ASA MAISONS ALFORT, n° 0946822. "
        "Ce n’est pas l’ASAS, une autre association, à Paris. "
        "Pas de site internet du club."
    ),
}

# Villes lisibles dans le nom officiel du club. Pas d’adresse inventée.
CITY_HINTS = (
    ("MAISONS-ALFORT", "Maisons-Alfort"),
    ("MAISONS ALFORT", "Maisons-Alfort"),
    ("LIMEIL-BREVANNES", "Limeil-Brévannes"),
    ("LIMEIL", "Limeil-Brévannes"),
    ("CHEVILLY-LARUE", "Chevilly-Larue"),
    ("CHEVILLY", "Chevilly-Larue"),
    ("CHOISY", "Choisy-le-Roi"),
    ("VILLEJUIF", "Villejuif"),
    ("FONTENAY", "Fontenay-sous-Bois"),
    ("CHAMPIGNY", "Champigny-sur-Marne"),
    ("NOGENT", "Nogent-sur-Marne"),
    ("VINCENNES", "Vincennes"),
    ("GENTILLY", "Gentilly"),
    ("FRESNES", "Fresnes"),
    ("CRÉTEIL", "Créteil"),
    ("CRETEIL", "Créteil"),
    ("VITRY", "Vitry-sur-Seine"),
    ("CHARENTON", "Charenton-le-Pont"),
    ("SUCY", "Sucy-en-Brie"),
    ("ALFORTVILLAISE", "Alfortville"),
    ("ALFORTVILLE", "Alfortville"),
    ("PERREUX", "Le Perreux-sur-Marne"),
    ("ST MAUR", "Saint-Maur-des-Fossés"),
    ("SAINT-MAUR", "Saint-Maur-des-Fossés"),
    ("SAINT MAUR", "Saint-Maur-des-Fossés"),
    ("VILLIERS", "Villiers-sur-Marne"),
)

STAT_KEYS = (
    "points", "played", "won", "lost", "forfeit",
    "w3_0", "w3_1", "w3_2", "l2_3", "l1_3", "l0_3",
    "sets_for", "sets_against", "sets_ratio",
    "points_for", "points_against", "points_ratio",
)

SMALL_WORDS = {"de", "du", "des", "la", "le", "les", "au", "aux", "et", "sur", "en", "a"}

LIMITS = [
    "Pas de compte et pas de notification sur le téléphone. Une équipe épinglée reste dans ce navigateur. Pour un rappel, ajoute le calendrier (.ics).",
    "Pas de feuille de match, pas de licence, pas de téléphone ni d’e-mail de dirigeant.",
    "La Coupe de France et le championnat pro (LNV) ne sont pas dans cette version.",
    "Les matchs départementaux, de loisir, de jeunes, régionaux et pré-nationaux des clubs du 94 sont inclus. Les adversaires hors département apparaissent dans le classement, sans fiche club.",
]

SOURCES = [
    {"label": "Liste des clubs du comité", "url": DEPARTMENT["clubs_url"]},
    {"label": "Page résultats du comité", "url": DEPARTMENT["results_url"]},
    {"label": "Compétitions FFVB du Val-de-Marne", "url": "https://www.ffvbbeach.org/ffvbapp/resu/vbspo_home.php?codent=PTIDF94"},
    {"label": "Compétitions de la ligue Île-de-France", "url": "https://www.ffvbbeach.org/ffvbapp/resu/vbspo_home.php?codent=LIIDF"},
    {"label": "Guide municipal de Maisons-Alfort (nom du club)", "url": "https://maisons-alfort.fr/wp-content/uploads/2018/12/2026-2027-temps-libre.pdf"},
]


def guard(url: str) -> None:
    parts = urllib.parse.urlparse(url)
    if parts.scheme != "https" or parts.netloc not in ALLOWED_HOSTS:
        raise RuntimeError(f"Hôte non prévu : {url}")
    low = url.lower()
    for bit in FORBIDDEN:
        if bit in low:
            raise RuntimeError(f"URL interdite : {url}")


def fetch(url: str, data: dict | None = None) -> bytes:
    guard(url)
    last = None
    for _attempt in range(2):
        payload = None if data is None else urllib.parse.urlencode(data).encode("ascii")
        req = urllib.request.Request(url, data=payload, headers={"User-Agent": USER_AGENT})
        if payload is not None:
            req.add_header("Content-Type", "application/x-www-form-urlencoded")
        try:
            with urllib.request.urlopen(req, timeout=40) as resp:
                raw = resp.read()
            time.sleep(0.35)
            return raw
        except (urllib.error.URLError, TimeoutError) as exc:
            last = exc
            time.sleep(1)
    raise last


def strip_tags(value: str) -> str:
    text = re.sub(r"<[^>]+>", " ", value)
    text = unescape(text).replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def norm_code(value: str) -> str:
    digits = re.sub(r"\D", "", value or "")
    if not digits:
        return ""
    return digits.zfill(7) if len(digits) < 7 else digits


def pretty_words(value: str) -> str:
    text = re.sub(r"\s+", " ", (value or "").strip())
    if not text:
        return ""
    parts = []
    for index, token in enumerate(text.split(" ")):
        bits = []
        for bit_index, word in enumerate(token.split("-")):
            bare = word.strip(".,;/")
            low = bare.lower()
            if any(ch.isdigit() for ch in bare) and bare.upper() == bare:
                bits.append(bare)
            elif bare.isalpha() and bare.isupper() and len(bare) <= 3:
                bits.append(bare)
            elif low in SMALL_WORDS and (index > 0 or bit_index > 0):
                bits.append(low)
            elif bare.isupper() or bare.islower():
                bits.append(low.capitalize())
            else:
                bits.append(bare)
        parts.append("-".join(bits))
    text = " ".join(parts)
    return re.sub(r"\bMaisons Alfort\b", "Maisons-Alfort", text)


def city_from_name(ffvb_name: str) -> str | None:
    folded = compact(ffvb_name)
    for hint, city in CITY_HINTS:
        if compact(hint) in folded:
            return city
    return None


def parse_stat(value: str):
    text = (value or "").strip().replace(",", ".")
    if not text:
        return 0
    if text.upper() == "MAX":
        return "MAX"
    try:
        number = float(text)
    except ValueError:
        return text
    if number.is_integer():
        return int(number)
    return round(number, 3)


def parse_clubs(html: str) -> list[dict]:
    found = []
    seen = set()
    for code, name in re.findall(r"<td>\s*(094\d{4})\s*</td>\s*<td>\s*([^<]+)", html, flags=re.I):
        code = norm_code(code)
        if code in seen:
            continue
        seen.add(code)
        ffvb_name = unescape(name).replace("\xa0", " ").strip()
        found.append({"id": code, "ffvb_name": re.sub(r"\s+", " ", ffvb_name)})
    return found


def parse_menu(html: str, entity: str) -> list[dict]:
    poules = []
    seen = set()
    pattern = re.compile(
        r"href=['\"](vbspo_calendrier\.php\?[^'\"]+)['\"][^>]*>(.*?)</a>",
        flags=re.I | re.S,
    )
    for href, text in pattern.findall(html):
        label = strip_tags(text)
        query = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
        code = (query.get("poule") or [""])[0].strip()
        if not code or code in seen:
            continue
        seen.add(code)
        season = (query.get("saison") or ["2026/2027"])[0]
        poules.append({
            "entity": entity,
            "code": code,
            "official_raw": label,
            "season": season,
        })
    return poules


def is_league_senior(label: str) -> bool:
    text = compact(label)
    if "BEACH" in text or "COUPE" in text or "SENIOR" not in text:
        return False
    return "PRE-NATIONAL" in text or "PRE NATIONAL" in text or "REGIONAL" in text


def classify(label: str) -> tuple[str, str, str]:
    text = compact(label)
    if "MIXTE" in text:
        gender = "mixte"
    elif "FEMIN" in text:
        gender = "feminin"
    elif "MASCUL" in text:
        gender = "masculin"
    else:
        gender = "inconnu"
    category = "senior"
    for code in ("M11", "M13", "M15", "M18", "M21"):
        if code in text:
            category = code.lower()
            break
    if "LOISIR" in text:
        category = "loisir"
    if "PRE-NATIONAL" in text or "PRE NATIONAL" in text:
        level = "pre-national"
    elif "ACCESSION" in text:
        level = "accession-regionale"
    elif "DEPARTEMENTAL" in text:
        level = "departemental"
    elif "LOISIR" in text:
        level = "loisir"
    elif "REGIONAL" in text:
        level = "regional"
    elif category != "senior":
        level = "jeunes"
    elif "NATIONAL" in text:
        level = "national"
    else:
        level = "autre"
    return gender, level, category


def official_name(code: str, raw: str) -> str:
    text = re.sub(r"\s+", " ", raw).strip()
    return re.sub(rf"^{re.escape(code)}\s+", "", text, flags=re.I).strip()


def group_of(official: str) -> str | None:
    match = re.search(r"POULE\s+([A-Z0-9]+)\s*$", compact(official))
    if not match:
        return None
    group = match.group(1)
    return "haute" if group == "HAUTE" else group


def friendly_label(official: str, gender: str, level: str, category: str) -> str:
    text = compact(official)
    gender_word = {
        "feminin": "féminin",
        "masculin": "masculin",
        "mixte": "mixte",
    }.get(gender, "")
    ages = {
        "m11": "Moins de 11 ans",
        "m13": "Moins de 13 ans",
        "m15": "Moins de 15 ans",
        "m18": "Moins de 18 ans",
        "m21": "Moins de 21 ans",
    }
    if level == "departemental":
        base = f"Départemental seniors {gender_word}"
    elif level == "accession-regionale":
        base = f"Accession régionale seniors {gender_word}"
    elif level == "pre-national":
        base = f"Pré-national seniors {gender_word}"
    elif level == "regional":
        number = re.search(r"REGIONAL\s+([12])", text)
        rank = number.group(1) + " " if number else ""
        base = f"Régional {rank}seniors {gender_word}"
    elif level == "loisir":
        if "4X4" in text or "4 X 4" in text:
            kind = "4 contre 4 "
        elif "6X6" in text or "6 X 6" in text:
            kind = "6 contre 6 "
        else:
            kind = ""
        base = f"Loisir {kind}{gender_word}"
    elif level == "jeunes":
        base = f"{ages.get(category, 'Jeunes')} {gender_word}"
    else:
        base = official[:1].upper() + official[1:].lower() if official else "Compétition"
    return re.sub(r"\s+", " ", base).strip()


def row_website(part: str) -> str | None:
    for href in re.findall(r"href=['\"]((?:https?:)?//[^'\"]+)['\"]", part, flags=re.I):
        href = href.strip()
        if href.startswith("//"):
            href = "https:" + href
        host = urllib.parse.urlparse(href).netloc.lower()
        if "ffvb" in host or "ffvolley" in host:
            continue
        return href
    return None


def parse_standings(html: str) -> list[dict]:
    rows = []
    seen = set()
    for part in re.split(r"<tr\b", html, flags=re.I):
        rank_match = re.search(r">\s*(\d+)\.\s*<", part)
        if not rank_match:
            continue
        head = part.split("<form", 1)[0]
        cells = re.findall(r"<td\b[^>]*>(.*?)</td>", head, flags=re.I | re.S)
        texts = [strip_tags(cell) for cell in cells]
        if len(texts) < 8 or not texts[1]:
            continue
        key = (int(rank_match.group(1)), texts[1])
        if key in seen:
            continue
        seen.add(key)
        club_match = re.search(r"name=cnclub value=(\d+)", part, flags=re.I)
        website = row_website(part)
        stats = texts[2:19]
        while len(stats) < 17:
            stats.append("")
        rows.append({
            "rank": key[0],
            "ffvb_name": texts[1],
            "ffvb_code": norm_code(club_match.group(1)) if club_match else "",
            "website": website,
            "stats": [parse_stat(value) for value in stats[:17]],
        })
    rows.sort(key=lambda row: row["rank"])
    return rows


def parse_composition(html: str) -> list[dict]:
    """Liste des équipes quand la FFVB n’a pas encore publié le classement chiffré.

    Les lignes ne sont pas toujours fermées : on accroche le nom, le numéro
    d’ordre, puis le premier numéro de club qui suit.
    """
    rows = []
    seen = set()
    pattern = re.compile(
        r"align='left'>\s*([^<]+?)\s*</td>\s*<td[^>]*>\s*(\d{1,2})\s*</td>"
        r"([\s\S]{0,1800}?)name=cnclub value=(\d+)",
        flags=re.I,
    )
    for name, _slot, chunk, club in pattern.findall(html):
        name = unescape(name).replace("\xa0", " ").strip()
        if not re.search(r"[A-Za-z]", name) or re.fullmatch(r"[A-Z0-9]{4,12}", name):
            continue
        code = norm_code(club)
        key = (code, name)
        if key in seen:
            continue
        seen.add(key)
        rows.append({
            "rank": None,
            "ffvb_name": re.sub(r"\s+", " ", name),
            "ffvb_code": code,
            "website": row_website(chunk),
            "stats": None,
        })
    return rows


def parse_csv(text: str) -> list[dict]:
    reader = csv.DictReader(io.StringIO(text), delimiter=";")
    rows = []
    for raw in reader:
        row = {}
        for key, value in raw.items():
            if not key:
                continue
            row[key.strip().lstrip("\ufeff")] = (value or "").strip()
        if row.get("Match") and row.get("Date"):
            rows.append(row)
    return rows


def col(row: dict, *names: str) -> str:
    wanted = {name.casefold() for name in names}
    for key, value in row.items():
        if key.casefold() in wanted and value:
            return value
    return ""


def parse_time(value: str) -> str | None:
    match = re.match(r"^(\d{1,2}):(\d{2})", (value or "").strip())
    if not match:
        return None
    if match.group(1) == "00" and match.group(2) == "00":
        return None
    return f"{int(match.group(1)):02d}:{match.group(2)}"


def parse_sets(value: str) -> tuple[int | None, int | None]:
    match = re.fullmatch(r"(\d+)\s*/\s*(\d+)", (value or "").strip())
    if not match:
        return None, None
    return int(match.group(1)), int(match.group(2))


def clean_referee(value: str) -> str | None:
    text = re.sub(r"\s+", " ", (value or "")).strip(" -/")
    if not text or text.casefold() in {"supervision", "sans", "neant", "néant", "non"}:
        return None
    return text


def clean_gym(value: str) -> str | None:
    text = re.sub(r"\s+", " ", (value or "")).strip(" /")
    return text or None


def poule_page(entity: str, code: str, season: str) -> str:
    return (
        "https://www.ffvbbeach.org/ffvbapp/resu/vbspo_calendrier.php"
        f"?saison={season}&codent={entity}&poule={code}"
    )


def home_page(entity: str) -> str:
    return f"https://www.ffvbbeach.org/ffvbapp/resu/vbspo_home.php?codent={entity}"


def export_fields(entity: str, code: str, season: str) -> dict:
    return {
        "cal_saison": season,
        "cal_codent": entity,
        "cal_codpoule": code,
        "cal_coddiv": "",
        "cal_codtour": "",
        "typ_edition": "E",
        "type": "RES",
        "rech_equipe": "",
    }


def slug(value: str) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", compact(value).lower()).strip("-")
    return text[:48] or "equipe"


def make_team_id(club_id: str, entity: str, poule_code: str, ffvb_name: str, used: set[str]) -> str:
    number = re.search(r"(\d+)\s*$", ffvb_name.strip())
    suffix = f"-{number.group(1)}" if number else ""
    base = f"{club_id}-{entity}-{poule_code}{suffix}"
    if base not in used:
        used.add(base)
        return base
    alt = f"{base}-{slug(ffvb_name)}"
    counter = 2
    while alt in used:
        alt = f"{base}-{slug(ffvb_name)}-{counter}"
        counter += 1
    used.add(alt)
    return alt


def norm_team_name(value: str) -> str:
    return re.sub(r"\s+", " ", compact(value).replace("-", " ")).strip()


def involves(rows: list[dict], club_ids: set[str]) -> bool:
    for row in rows:
        if norm_code(col(row, "EQA_no")) in club_ids or norm_code(col(row, "EQB_no")) in club_ids:
            return True
    return False


def build(clubs_raw, kept, csv_by_poule, season, warnings) -> dict:
    clubs = []
    by_id = {}
    for raw in clubs_raw:
        featured = raw["id"] == FEATURED["id"]
        club = {
            "id": raw["id"],
            "department_code": DEPARTMENT["code"],
            "ffvb_name": raw["ffvb_name"],
            "name": FEATURED["name"] if featured else pretty_words(raw["ffvb_name"]),
            "short_name": FEATURED["short_name"] if featured else pretty_words(raw["ffvb_name"]),
            "city": FEATURED["city"] if featured else city_from_name(raw["ffvb_name"]),
            "featured": featured,
            "website": None,
            "usual_gym": None,
            "note": FEATURED["note"] if featured else None,
            "planning_url": (
                "https://www.ffvbbeach.org/ffvbapp/resu/planning_club.php?cnclub=" + raw["id"]
            ),
        }
        clubs.append(club)
        by_id[club["id"]] = club

    poules = []
    teams = []
    matches = []
    used_team_ids: set[str] = set()
    used_match_ids: set[str] = set()

    for source in kept:
        entity = source["entity"]
        code = source["code"]
        official = official_name(code, source["official_raw"])
        gender, level, category = classify(official or source["official_raw"])
        rankings = []
        for row in source.get("rankings_raw") or []:
            if row.get("stats") is None:
                stats = {key: None for key in STAT_KEYS}
                standing = None
            else:
                stats = dict(zip(STAT_KEYS, row["stats"]))
                standing = {
                    "rank": row["rank"],
                    "points": stats["points"],
                    "played": stats["played"],
                    "won": stats["won"],
                    "lost": stats["lost"],
                    "forfeit": stats["forfeit"],
                }
            code_club = row["ffvb_code"]
            in_department = code_club in by_id
            if row["website"] and in_department and code_club != FEATURED["id"]:
                current = by_id[code_club]["website"]
                if current and current != row["website"]:
                    warnings.append(f"Deux sites FFVB pour le club {code_club}, le premier est gardé.")
                elif not current:
                    by_id[code_club]["website"] = row["website"]
            item = {
                "rank": row["rank"],
                "ffvb_name": row["ffvb_name"],
                "name": pretty_words(row["ffvb_name"]),
                "ffvb_code": code_club or None,
                "club_id": code_club if in_department else None,
                "team_id": None,
                "in_department": in_department,
                **stats,
            }
            if in_department:
                team_id = make_team_id(code_club, entity, code, row["ffvb_name"], used_team_ids)
                item["team_id"] = team_id
                teams.append({
                    "id": team_id,
                    "club_id": code_club,
                    "poule_id": f"{entity}-{code}",
                    "department_code": DEPARTMENT["code"],
                    "ffvb_name": row["ffvb_name"],
                    "name": pretty_words(row["ffvb_name"]),
                    "usual_gym": None,
                    "standing": standing,
                })
            rankings.append(item)

        poule_id = f"{entity}-{code}"
        poule_teams = [team for team in teams if team["poule_id"] == poule_id]
        known_clubs = {team["club_id"] for team in poule_teams}
        for row in csv_by_poule.get((entity, code), []):
            for side_no, side_name in (("EQA_no", "EQA_nom"), ("EQB_no", "EQB_nom")):
                club_code = norm_code(col(row, side_no))
                if club_code in by_id and club_code not in known_clubs:
                    ffvb_name = col(row, side_name) or by_id[club_code]["ffvb_name"]
                    team_id = make_team_id(club_code, entity, code, ffvb_name, used_team_ids)
                    teams.append({
                        "id": team_id,
                        "club_id": club_code,
                        "poule_id": poule_id,
                        "department_code": DEPARTMENT["code"],
                        "ffvb_name": ffvb_name,
                        "name": pretty_words(ffvb_name),
                        "usual_gym": None,
                        "standing": None,
                    })
                    known_clubs.add(club_code)
                    poule_teams.append(teams[-1])

        by_club = defaultdict(list)
        for team in poule_teams:
            by_club[team["club_id"]].append(team)

        def resolve(club_code: str, raw_name: str) -> str | None:
            cands = by_club.get(club_code) or []
            if not cands:
                return None
            if len(cands) == 1:
                return cands[0]["id"]
            wanted = norm_team_name(raw_name)
            for team in cands:
                if norm_team_name(team["ffvb_name"]) == wanted:
                    return team["id"]
            wanted_tokens = set(wanted.split())
            best = max(
                cands,
                key=lambda team: len(wanted_tokens & set(norm_team_name(team["ffvb_name"]).split())),
            )
            return best["id"]

        for row in csv_by_poule.get((entity, code), []):
            match_code = col(row, "Match")
            match_date = col(row, "Date")
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", match_date):
                continue
            sets_home, sets_away = parse_sets(col(row, "Set"))
            score = col(row, "Score") or None
            home_code = norm_code(col(row, "EQA_no"))
            away_code = norm_code(col(row, "EQB_no"))
            home_ffvb = col(row, "EQA_nom")
            away_ffvb = col(row, "EQB_nom")
            match_id = f"{entity}-{code}-{match_code}-{match_date}"
            if match_id in used_match_ids:
                match_id = f"{match_id}-{len(used_match_ids)}"
            used_match_ids.add(match_id)
            gym = clean_gym(col(row, "Salle"))
            matches.append({
                "id": match_id,
                "poule_id": poule_id,
                "code": match_code,
                "journee": col(row, "Jo") or None,
                "date": match_date,
                "time": parse_time(col(row, "Heure")),
                "home_ffvb_name": home_ffvb,
                "away_ffvb_name": away_ffvb,
                "home_name": pretty_words(home_ffvb),
                "away_name": pretty_words(away_ffvb),
                "home_ffvb_code": home_code or None,
                "away_ffvb_code": away_code or None,
                "home_club_id": home_code if home_code in by_id else None,
                "away_club_id": away_code if away_code in by_id else None,
                "home_team_id": resolve(home_code, home_ffvb),
                "away_team_id": resolve(away_code, away_ffvb),
                "sets_home": sets_home,
                "sets_away": sets_away,
                "score": score,
                "total": col(row, "Total") or None,
                "gym": gym,
                "gym_label": pretty_words(gym) if gym else None,
                "referee_1": clean_referee(col(row, "Arb1")),
                "referee_2": clean_referee(col(row, "Arb2")),
                "status": "joue" if (sets_home is not None or score) else "a_venir",
            })

        poules.append({
            "id": poule_id,
            "department_code": DEPARTMENT["code"],
            "entity": entity,
            "code": code,
            "scope": "comite" if entity == DEPARTMENT["ffvb_entity"] else "ligue",
            "shared": entity != DEPARTMENT["ffvb_entity"],
            "official_name": official,
            "label": friendly_label(official, gender, level, category),
            "gender": gender,
            "level": level,
            "category": category,
            "group": group_of(official),
            "url": poule_page(entity, code, season),
            "has_standing": any(item.get("points") is not None for item in rankings),
            "rankings": rankings,
        })
        print(
            f"{entity} {code} : {len(rankings)} au classement, "
            f"{len(csv_by_poule.get((entity, code), []))} matchs",
            flush=True,
        )

    gyms = Counter()
    for match in matches:
        if match.get("home_team_id") and match.get("gym_label"):
            gyms[(match["home_team_id"], match["gym_label"])] += 1
    per_team = defaultdict(Counter)
    for (team_id, gym), count in gyms.items():
        per_team[team_id][gym] += count
    for team in teams:
        if per_team[team["id"]]:
            team["usual_gym"] = per_team[team["id"]].most_common(1)[0][0]
    per_club = defaultdict(Counter)
    for team in teams:
        if team.get("usual_gym"):
            per_club[team["club_id"]][team["usual_gym"]] += 1
    for club in clubs:
        if per_club[club["id"]]:
            club["usual_gym"] = per_club[club["id"]].most_common(1)[0][0]

    clubs.sort(key=lambda club: club["id"])
    poules.sort(key=lambda poule: (poule["scope"], poule["code"]))
    teams.sort(key=lambda team: team["id"])
    matches.sort(key=lambda match: (match["date"], match.get("time") or "99", match["code"]))
    return {
        "season": season,
        "generated_at": datetime.now(PARIS).isoformat(timespec="seconds"),
        "featured_club_id": FEATURED["id"],
        "department": {
            "code": DEPARTMENT["code"],
            "name": DEPARTMENT["name"],
            "committee_name": DEPARTMENT["committee_name"],
            "committee_url": DEPARTMENT["committee_url"],
            "ffvb_entity": DEPARTMENT["ffvb_entity"],
            "league_entity": DEPARTMENT["league_entity"],
        },
        "sources": SOURCES,
        "limits": LIMITS,
        "level_help": LEVEL_HELP,
        "warnings": warnings,
        "counts": {
            "clubs": len(clubs),
            "poules": len(poules),
            "teams": len(teams),
            "matches": len(matches),
        },
        "clubs": clubs,
        "poules": poules,
        "teams": teams,
        "matches": matches,
    }


def main() -> int:
    warnings = []
    print("Clubs…", flush=True)
    clubs_html = fetch(DEPARTMENT["clubs_url"]).decode("utf-8", "replace")
    clubs = parse_clubs(clubs_html)
    if not any(club["id"] == FEATURED["id"] for club in clubs):
        print("Club 0946822 absent de la liste du comité.", file=sys.stderr)
        return 1
    club_ids = {club["id"] for club in clubs}
    print(f"{len(clubs)} clubs", flush=True)

    print("Menus des compétitions…", flush=True)
    committee = parse_menu(
        fetch(home_page(DEPARTMENT["ffvb_entity"])).decode("cp1252", "replace"),
        DEPARTMENT["ffvb_entity"],
    )
    league = [
        poule for poule in parse_menu(
            fetch(home_page(DEPARTMENT["league_entity"])).decode("cp1252", "replace"),
            DEPARTMENT["league_entity"],
        )
        if is_league_senior(poule["official_raw"])
    ]
    if not committee:
        print("Menu du comité vide.", file=sys.stderr)
        return 1
    season = committee[0]["season"]
    if not re.fullmatch(r"\d{4}/\d{4}", season):
        print(f"Saison inattendue : {season}", file=sys.stderr)
        return 1

    try:
        results_html = unescape(fetch(DEPARTMENT["results_url"]).decode("utf-8", "replace"))
        announced = set(re.findall(r"[?&]poule=([A-Za-z0-9]+)", results_html))
        missing = sorted(code for code in announced if code not in {p["code"] for p in committee})
        if missing:
            warnings.append(
                "Codes cités sur la page résultats du comité, absents du menu FFVB : "
                + ", ".join(missing)
            )
        if not announced:
            warnings.append("La page résultats du comité n’a pas donné de code de poule. Le menu FFVB est utilisé.")
    except (urllib.error.URLError, TimeoutError, RuntimeError) as exc:
        warnings.append(f"Page résultats du comité illisible ({exc}). Menu FFVB utilisé.")

    export_url = "https://www.ffvbbeach.org/ffvbapp/resu/vbspo_calendrier_export.php"
    kept = []
    csv_by_poule = {}
    for poule in committee + league:
        key = (poule["entity"], poule["code"])
        print(f"Calendrier {poule['entity']} {poule['code']}…", flush=True)
        try:
            raw = fetch(export_url, export_fields(poule["entity"], poule["code"], season))
        except (urllib.error.URLError, TimeoutError, RuntimeError) as exc:
            warnings.append(f"Export {poule['entity']} {poule['code']} en échec ({exc}).")
            if poule["entity"] == DEPARTMENT["ffvb_entity"]:
                csv_by_poule[key] = []
                kept.append(poule)
            continue
        text = raw.decode("cp1252", "replace")
        if not text.lstrip().lower().startswith("entit"):
            warnings.append(f"Export {poule['entity']} {poule['code']} illisible, poule ignorée.")
            continue
        rows = parse_csv(text)
        if poule["entity"] == DEPARTMENT["league_entity"] and not involves(rows, club_ids):
            continue
        csv_by_poule[key] = rows
        kept.append(poule)

    empty_poules = []
    for poule in kept:
        print(f"Classement {poule['code']}…", flush=True)
        try:
            html = fetch(poule_page(poule["entity"], poule["code"], season)).decode("cp1252", "replace")
        except (urllib.error.URLError, TimeoutError, RuntimeError) as exc:
            warnings.append(f"Classement {poule['entity']} {poule['code']} en échec ({exc}).")
            poule["rankings_raw"] = []
            continue
        standings = parse_standings(html)
        poule["rankings_raw"] = standings or parse_composition(html)
        match_count = len(csv_by_poule.get((poule["entity"], poule["code"]), []))
        if not poule["rankings_raw"] and match_count:
            warnings.append(
                f"Ni classement ni liste d’équipes pour {poule['entity']} {poule['code']} "
                f"({match_count} matchs)."
            )
        elif not poule["rankings_raw"]:
            empty_poules.append(poule["code"])
    if empty_poules:
        warnings.append(
            "Poules sans match publié pour l’instant : " + ", ".join(empty_poules) + "."
        )

    data = build(clubs, kept, csv_by_poule, season, warnings)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / DEPARTMENT["output"]
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    counts = data["counts"]
    print(
        f"Écrit {path} — {counts['clubs']} clubs, {counts['poules']} poules, "
        f"{counts['teams']} équipes, {counts['matches']} matchs",
        flush=True,
    )
    asa = [team for team in data["teams"] if team["club_id"] == FEATURED["id"]]
    print(f"ASA Maisons-Alfort : {len(asa)} équipes", flush=True)
    for warning in warnings:
        print("Réserve :", warning, flush=True)
    if not asa:
        print("Aucune équipe ASA dans les poules retenues.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
