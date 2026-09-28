"""Lecture des JSON, filtres, fiches et calendriers .ics.

Un fichier data/<département>.json par territoire. Le serveur les réunit.
Les poules de ligue sont celles où joue au moins un club du département :
si deux fichiers partagent le même id de poule, le dernier fichier gagne.
"""

from __future__ import annotations

import json
import re
import unicodedata
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
PARIS = ZoneInfo("Europe/Paris")

LEVEL_HELP = {
    "departemental": "Le championnat du département, le plus proche.",
    "accession-regionale": "Entre le championnat du département et celui de la région.",
    "regional": "Le championnat d’Île-de-France.",
    "pre-national": "Juste en dessous du championnat de France.",
    "jeunes": "Équipes de jeunes, des moins de 11 ans aux moins de 18 ans.",
    "loisir": "Pour jouer sans monter ni descendre. Souvent à 4 contre 4.",
    "national": "Le championnat de France.",
    "autre": "Compétition dont le niveau n’est pas plus précis.",
}

GENDER_LABEL = {
    "feminin": "Féminin",
    "masculin": "Masculin",
    "mixte": "Mixte",
    "inconnu": "Non précisé",
}

LEVEL_LABEL = {
    "departemental": "Départemental",
    "accession-regionale": "Accession régionale",
    "regional": "Régional",
    "pre-national": "Pré-national",
    "jeunes": "Jeunes",
    "loisir": "Loisir",
    "national": "National",
    "autre": "Autre",
}

_CACHE: dict = {"key": None, "data": None}


def fold(value) -> str:
    """Minuscules, sans accent, ponctuation remplacée par des espaces."""
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = text.casefold()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def compact(value) -> str:
    """Majuscules sans accent, pour reconnaître un libellé FFVB."""
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return text.upper()


def query_matches(query: str, blob: str) -> bool:
    folded = fold(query)
    hay = fold(blob)
    if not folded:
        return True
    if folded in hay:
        return True
    words = hay.split()
    return all(tok in hay or any(word.startswith(tok) for word in words) for tok in folded.split())


def load_dataset() -> dict:
    files = tuple(sorted(DATA_DIR.glob("*.json")))
    key = tuple((str(path), path.stat().st_mtime_ns) for path in files)
    if _CACHE["key"] == key and _CACHE["data"] is not None:
        return _CACHE["data"]
    if not files:
        raise FileNotFoundError("Aucune donnée dans data/. Lance python3 refresh_data.py")
    clubs, poules, teams, matches = {}, {}, {}, {}
    departments = []
    meta = {}
    for path in files:
        blob = json.loads(path.read_text(encoding="utf-8"))
        departments.append(blob["department"])
        meta = blob
        for item, dest in (
            (blob["clubs"], clubs),
            (blob["poules"], poules),
            (blob["teams"], teams),
            (blob["matches"], matches),
        ):
            for obj in item:
                dest[obj["id"]] = obj
    data = {
        "departments": departments,
        "season": meta.get("season"),
        "generated_at": meta.get("generated_at"),
        "featured_club_id": meta.get("featured_club_id"),
        "sources": meta.get("sources") or [],
        "limits": meta.get("limits") or [],
        "warnings": meta.get("warnings") or [],
        "level_help": meta.get("level_help") or LEVEL_HELP,
        "clubs": clubs,
        "poules": poules,
        "teams": teams,
        "matches": matches,
    }
    _CACHE["key"] = key
    _CACHE["data"] = data
    return data


def today_paris() -> str:
    return datetime.now(PARIS).date().isoformat()


def _poule(data, team):
    return data["poules"][team["poule_id"]]


def _club(data, team):
    return data["clubs"][team["club_id"]]


def public_match(match: dict, poule: dict | None = None) -> dict:
    score = (match.get("score") or "").strip()
    if score:
        score = re.sub(r"\s*,\s*", ", ", score)
    total = match.get("total") or None
    if total and "-" in total:
        left, right = total.split("-", 1)
        total_label = f"{left.strip()} à {right.strip()}"
    else:
        total_label = total
    return {
        "id": match["id"],
        "code": match["code"],
        "date": match["date"],
        "time": match.get("time"),
        "home_name": match["home_name"],
        "away_name": match["away_name"],
        "home_team_id": match.get("home_team_id"),
        "away_team_id": match.get("away_team_id"),
        "home_club_id": match.get("home_club_id"),
        "away_club_id": match.get("away_club_id"),
        "gym_label": match.get("gym_label"),
        "sets_home": match.get("sets_home"),
        "sets_away": match.get("sets_away"),
        "score": score or None,
        "total": total_label,
        "status": match["status"],
        "referee_1": match.get("referee_1"),
        "referee_2": match.get("referee_2"),
        "poule_id": match["poule_id"],
        "poule_code": poule["code"] if poule else None,
        "poule_label": poule["label"] if poule else None,
        "poule_url": poule["url"] if poule else None,
    }


def _next_match(data, team_id: str):
    today = today_paris()
    found = [
        match
        for match in data["matches"].values()
        if team_id in (match.get("home_team_id"), match.get("away_team_id"))
        and match["date"] >= today
        and match["status"] != "joue"
    ]
    found.sort(key=lambda match: (match["date"], match.get("time") or "99", match["code"]))
    if not found:
        upcoming = [
            match
            for match in data["matches"].values()
            if team_id in (match.get("home_team_id"), match.get("away_team_id"))
            and match["date"] >= today
        ]
        upcoming.sort(key=lambda match: (match["date"], match.get("time") or "99", match["code"]))
        found = upcoming[:1]
    if not found:
        return None
    match = found[0]
    home = match.get("home_team_id") == team_id
    return {
        "id": match["id"],
        "date": match["date"],
        "time": match.get("time"),
        "opponent": match["away_name"] if home else match["home_name"],
        "gym_label": match.get("gym_label"),
        "home": home,
    }


def team_card(data, team: dict) -> dict:
    club = _club(data, team)
    poule = _poule(data, team)
    standing = team.get("standing") or {}
    size = len(poule.get("rankings") or [])
    return {
        "id": team["id"],
        "name": team["name"],
        "ffvb_name": team["ffvb_name"],
        "club_id": club["id"],
        "club_name": club["name"],
        "city": club.get("city"),
        "featured": bool(club.get("featured")),
        "poule_id": poule["id"],
        "poule_code": poule["code"],
        "label": poule["label"],
        "gender": poule["gender"],
        "level": poule["level"],
        "category": poule["category"],
        "group": poule.get("group"),
        "usual_gym": team.get("usual_gym"),
        "rank": standing.get("rank"),
        "poule_size": size,
        "points": standing.get("points"),
        "played": standing.get("played"),
        "won": standing.get("won"),
        "lost": standing.get("lost"),
        "next_match": _next_match(data, team["id"]),
    }


def _search_blob(data, team) -> str:
    club = _club(data, team)
    poule = _poule(data, team)
    return " ".join(
        str(part or "")
        for part in (
            team["name"],
            team["ffvb_name"],
            club["name"],
            club.get("short_name"),
            club.get("city"),
            club.get("ffvb_name"),
            club.get("note"),
            poule["label"],
            poule["code"],
            poule.get("official_name"),
        )
    )


def list_teams(data, club="", niveau="", sexe="", q="", ids="") -> dict:
    if ids:
        wanted = [item for item in ids.split(",") if item]
        teams = []
        missing = []
        for team_id in wanted:
            team = data["teams"].get(team_id)
            if team:
                teams.append(team_card(data, team))
            else:
                missing.append(team_id)
        return {"teams": teams, "missing": missing, "total": len(teams)}

    found = []
    for team in data["teams"].values():
        poule = _poule(data, team)
        if club and team["club_id"] != club:
            continue
        if niveau and poule["level"] != niveau:
            continue
        if sexe and poule["gender"] != sexe:
            continue
        if q and not query_matches(q, _search_blob(data, team)):
            continue
        found.append(team_card(data, team))
    found.sort(key=lambda card: (
        0 if card["featured"] else 1,
        card["next_match"]["date"] if card["next_match"] else "9999-99-99",
        fold(card["name"]),
        card["label"],
    ))
    return {"teams": found, "missing": [], "total": len(found)}


def public_club(club: dict, team_count: int | None = None) -> dict:
    payload = {
        "id": club["id"],
        "department_code": club["department_code"],
        "name": club["name"],
        "short_name": club.get("short_name"),
        "ffvb_name": club["ffvb_name"],
        "city": club.get("city"),
        "featured": bool(club.get("featured")),
        "website": club.get("website"),
        "usual_gym": club.get("usual_gym"),
        "note": club.get("note"),
        "planning_url": club.get("planning_url"),
    }
    if team_count is not None:
        payload["team_count"] = team_count
    return payload


def list_clubs(data) -> dict:
    clubs = []
    for club in data["clubs"].values():
        count = sum(1 for team in data["teams"].values() if team["club_id"] == club["id"])
        clubs.append(public_club(club, count))
    clubs.sort(key=lambda club: (0 if club["featured"] else 1, fold(club["name"])))
    return {"clubs": clubs}


def club_detail(data, club_id: str) -> dict | None:
    club = data["clubs"].get(club_id)
    if not club:
        return None
    teams = [team_card(data, team) for team in data["teams"].values() if team["club_id"] == club_id]
    teams.sort(key=lambda card: (card["label"], card["name"]))
    today = today_paris()
    own = [
        match
        for match in data["matches"].values()
        if club_id in (match.get("home_club_id"), match.get("away_club_id"))
    ]
    own.sort(key=lambda match: (match["date"], match.get("time") or "99", match["code"]))
    upcoming = []
    recent = []
    for match in own:
        view = public_match(match, data["poules"].get(match["poule_id"]))
        if match["date"] >= today and match["status"] != "joue":
            upcoming.append(view)
        elif match["date"] < today or match["status"] == "joue":
            recent.append(view)
    return {
        "club": public_club(club, len(teams)),
        "teams": teams,
        "upcoming": upcoming[:12],
        "recent": list(reversed(recent[-5:])),
    }


def _public_ranking(row: dict) -> dict:
    kept = {
        "rank": row.get("rank"),
        "name": row.get("name"),
        "ffvb_name": row.get("ffvb_name"),
        "ffvb_code": row.get("ffvb_code"),
        "team_id": row.get("team_id"),
        "in_department": bool(row.get("in_department")),
    }
    for key in (
        "points", "played", "won", "lost", "forfeit",
        "w3_0", "w3_1", "w3_2", "l2_3", "l1_3", "l0_3",
        "sets_for", "sets_against", "sets_ratio",
        "points_for", "points_against", "points_ratio",
    ):
        kept[key] = row.get(key, 0)
    return kept


def team_detail(data, team_id: str) -> dict | None:
    team = data["teams"].get(team_id)
    if not team:
        return None
    club = _club(data, team)
    poule = _poule(data, team)
    matches = [
        match
        for match in data["matches"].values()
        if team_id in (match.get("home_team_id"), match.get("away_team_id"))
    ]
    matches.sort(key=lambda match: (match["date"], match.get("time") or "99", match["code"]))
    today = today_paris()
    upcoming = []
    played = []
    for match in matches:
        view = public_match(match, poule)
        if match["date"] >= today and match["status"] != "joue":
            upcoming.append(view)
        else:
            played.append(view)
    return {
        "team": team_card(data, team),
        "club": public_club(club),
        "poule": {
            "id": poule["id"],
            "code": poule["code"],
            "label": poule["label"],
            "official_name": poule.get("official_name"),
            "gender": poule["gender"],
            "level": poule["level"],
            "category": poule["category"],
            "group": poule.get("group"),
            "url": poule["url"],
            "scope": poule.get("scope"),
            "shared": bool(poule.get("shared")),
        },
        "rankings": [_public_ranking(row) for row in poule.get("rankings") or []],
        "upcoming": upcoming,
        "played": list(reversed(played)),
        "upcoming_count": len(upcoming),
    }


def match_detail(data, match_id: str) -> dict | None:
    match = data["matches"].get(match_id)
    if not match:
        return None
    poule = data["poules"].get(match["poule_id"])
    return {"match": public_match(match, poule)}


def meta(data) -> dict:
    levels = []
    seen = set()
    for poule in data["poules"].values():
        if poule["level"] not in seen:
            seen.add(poule["level"])
            levels.append({
                "id": poule["level"],
                "label": LEVEL_LABEL.get(poule["level"], poule["level"]),
                "help": (data.get("level_help") or LEVEL_HELP).get(poule["level"], ""),
            })
    order = list(LEVEL_LABEL)
    levels.sort(key=lambda item: order.index(item["id"]) if item["id"] in order else 99)
    return {
        "season": data.get("season"),
        "generated_at": data.get("generated_at"),
        "featured_club_id": data.get("featured_club_id"),
        "departments": data.get("departments") or [],
        "counts": {
            "clubs": len(data["clubs"]),
            "teams": len(data["teams"]),
            "matches": len(data["matches"]),
            "poules": len(data["poules"]),
        },
        "levels": levels,
        "genders": [
            {"id": "feminin", "label": "Féminin (femmes, filles)"},
            {"id": "masculin", "label": "Masculin (hommes, garçons)"},
            {"id": "mixte", "label": "Mixte"},
        ],
        "level_help": data.get("level_help") or LEVEL_HELP,
        "limits": data.get("limits") or [],
        "sources": data.get("sources") or [],
        "warnings": data.get("warnings") or [],
        "poule_names": {poule["code"]: poule["label"] for poule in data["poules"].values()},
    }


def ics_escape(value) -> str:
    text = str(value or "")
    text = text.replace("\\", "\\\\")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\n", "\\n")
    text = text.replace(";", r"\;")
    text = text.replace(",", r"\,")
    return text


def _fold_line(line: str) -> str:
    raw = line.encode("utf-8")
    chunks = []
    while len(raw) > 73:
        cut = 73
        while cut > 0 and (raw[cut] & 0xC0) == 0x80:
            cut -= 1
        chunks.append(raw[:cut])
        raw = raw[cut:]
    chunks.append(raw)
    folded = chunks[0]
    for chunk in chunks[1:]:
        folded += b"\r\n " + chunk
    return folded.decode("utf-8")


def _fmt_utc(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def match_to_event(match: dict, poule: dict) -> dict:
    when = "Horaire à confirmer."
    if match.get("time"):
        when = "Heure " + match["time"].replace(":", "h") + "."
    lines = [
        poule.get("label") or poule.get("code") or "Volley",
        f"Référence {match['code']}",
        when,
        f"Salle : {match['gym_label']}" if match.get("gym_label") else "Salle non indiquée.",
    ]
    if match.get("referee_1") or match.get("referee_2"):
        names = " et ".join(name for name in (match.get("referee_1"), match.get("referee_2")) if name)
        lines.append(f"Arbitre : {names}.")
    if poule.get("url"):
        lines.append(poule["url"])
    return {
        "uid": f"{match['id']}@volley-app.local",
        "date": match["date"],
        "time": match.get("time"),
        "summary": f"Volley : {match['home_name']} – {match['away_name']}",
        "location": match.get("gym_label") or "",
        "description": "\n".join(lines),
    }


def build_ics(events: list[dict], calendar_name: str) -> str:
    stamp = _fmt_utc(datetime.now(timezone.utc))
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Volley 94//Calendrier//FR",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:" + ics_escape(calendar_name),
        "X-WR-TIMEZONE:Europe/Paris",
    ]
    for event in events:
        lines.append("BEGIN:VEVENT")
        lines.append(f"UID:{event['uid']}")
        lines.append(f"DTSTAMP:{stamp}")
        if event.get("time"):
            start = datetime.strptime(
                f"{event['date']} {event['time']}", "%Y-%m-%d %H:%M"
            ).replace(tzinfo=PARIS)
            end = start + timedelta(hours=2)
            lines.append(f"DTSTART:{_fmt_utc(start)}")
            lines.append(f"DTEND:{_fmt_utc(end)}")
        else:
            day = date.fromisoformat(event["date"])
            lines.append(f"DTSTART;VALUE=DATE:{day.strftime('%Y%m%d')}")
            lines.append(f"DTEND;VALUE=DATE:{(day + timedelta(days=1)).strftime('%Y%m%d')}")
        lines.append("SUMMARY:" + ics_escape(event["summary"]))
        if event.get("location"):
            lines.append("LOCATION:" + ics_escape(event["location"]))
        lines.append("DESCRIPTION:" + ics_escape(event["description"]))
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold_line(line) for line in lines) + "\r\n"


def team_ics(data, team_id: str) -> tuple[str, str] | None:
    team = data["teams"].get(team_id)
    if not team:
        return None
    poule = _poule(data, team)
    today = today_paris()
    matches = [
        match
        for match in data["matches"].values()
        if team_id in (match.get("home_team_id"), match.get("away_team_id"))
        and match["date"] >= today
        and match.get("status") != "joue"
    ]
    matches.sort(key=lambda match: (match["date"], match.get("time") or "99", match["code"]))
    name = f"Volley — {team['name']}"
    return build_ics([match_to_event(match, poule) for match in matches], name), _ics_filename(team["name"])


def match_ics(data, match_id: str) -> tuple[str, str] | None:
    match = data["matches"].get(match_id)
    if not match:
        return None
    poule = data["poules"].get(match["poule_id"]) or {"label": "Volley", "code": "", "url": ""}
    event = match_to_event(match, poule)
    return build_ics([event], event["summary"]), _ics_filename(match["code"])


def _ics_filename(name: str) -> str:
    slug = fold(name)
    slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")
    return (slug or "calendrier") + ".ics"
