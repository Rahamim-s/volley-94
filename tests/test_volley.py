#!/usr/bin/env python3
"""Contrôles sans framework : parseurs, calendrier, et parcours HTTP si les données sont là."""

from __future__ import annotations

import json
import sys
import threading
import unittest
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import app as app_module
import refresh_data
import volley_data

FIXTURE_ROW = """
<tr bgcolor='#EEEEF8'>
<td class='liengris_pt' align='right'>3.</td>
<td class='lienquestion_pt' align='left'>ASA MAISONS-ALFORT 2</td>
<td class='lienblanc_pt' align='center'>3</td>
<td class='liengris_pt' align='right'>1</td>
<td class='liengris_pt' align='right'>1</td>
<td></td><td></td>
<td class='liengris_pt' align='right'>1</td>
<td></td><td></td><td></td><td></td><td></td>
<td class='liengris_pt' align='right'>3</td>
<td></td>
<td class='liengris_pt' align='right'>MAX</td>
<td class='liengris_pt' align='right'>75</td>
<td class='liengris_pt' align='right'>55</td>
<td class='liengris_pt' align='right'>1.364</td>
<form method=get>
<td><input type=hidden name=cnclub value=0946822></td>
</form>
</tr>
"""

FIXTURE_CSV = (
    "Entité;Jo;Match;Date;Heure;EQA_no;EQA_nom;EQB_no;EQB_nom;Set;Score;Total;Salle;Arb1;Arb2;\n"
    "PTIDF94;01;ARMA002;2026-10-03;18:30;0946822;ASA MAISONS-ALFORT 2;0941121;ASM LE PERREUX; ; ; ;GYMNASE CONDORCET;SUPERVISION;;\n"
)


class UnitTests(unittest.TestCase):
    def test_featured_identity(self):
        self.assertEqual(refresh_data.FEATURED["id"], "0946822")
        self.assertEqual(refresh_data.FEATURED["name"], "Association sportive amicale Maisons-Alfort")
        self.assertEqual(refresh_data.FEATURED["short_name"], "ASA VB MA")
        self.assertIn("ASAS", refresh_data.FEATURED["note"])
        self.assertNotIn("website", refresh_data.FEATURED)

    def test_classify_and_labels(self):
        gender, level, category = refresh_data.classify("DEPARTEMENTAL - SENIOR FEMININES 94")
        self.assertEqual((gender, level, category), ("feminin", "departemental", "senior"))
        gender, level, category = refresh_data.classify("CHAMPIONNAT PRE-NATIONAL SENIOR MASCULIN : POULE A")
        self.assertEqual((gender, level), ("masculin", "pre-national"))
        gender, level, category = refresh_data.classify("PRECHAMPIONNAT M13 FEMININ")
        self.assertEqual((gender, level, category), ("feminin", "jeunes", "m13"))
        gender, level, _category = refresh_data.classify("LOISIR 4x4 FEMININ")
        self.assertEqual((gender, level), ("feminin", "loisir"))
        self.assertFalse(refresh_data.is_league_senior("BBF CHAMPIONNAT REG DE BEACH VOLLEY"))
        self.assertTrue(refresh_data.is_league_senior("1FA CHAMPIONNAT REGIONAL 1 SENIOR FEMININ : POULE A"))

    def test_names_and_city(self):
        self.assertEqual(refresh_data.pretty_words("ASA MAISONS-ALFORT 2"), "ASA Maisons-Alfort 2")
        self.assertEqual(refresh_data.pretty_words("ASA MAISONS ALFORT 1"), "ASA Maisons-Alfort 1")
        self.assertEqual(refresh_data.pretty_words("GYMNASE CONDORCET"), "Gymnase Condorcet")
        self.assertEqual(refresh_data.city_from_name("ASA MAISONS ALFORT"), "Maisons-Alfort")
        self.assertIsNone(refresh_data.city_from_name("CAUDA VOLLEY-BALL"))

    def test_standings_and_csv(self):
        rows = refresh_data.parse_standings(FIXTURE_ROW)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["ffvb_code"], "0946822")
        self.assertEqual(rows[0]["ffvb_name"], "ASA MAISONS-ALFORT 2")
        self.assertEqual(rows[0]["stats"][0], 3)
        self.assertEqual(rows[0]["stats"][13], "MAX")
        composition = refresh_data.parse_composition(
            "<tr><td class='liengris_pt' align='left'>ASA MAISONS ALFORT 1</td>"
            "<td>01</td><form><input type=hidden name=cnclub value=0946822></form></tr>"
        )
        self.assertEqual(composition[0]["ffvb_code"], "0946822")
        self.assertIsNone(composition[0]["stats"])
        parsed = refresh_data.parse_csv(FIXTURE_CSV)
        self.assertEqual(parsed[0]["Match"], "ARMA002")
        self.assertIsNone(refresh_data.clean_referee("SUPERVISION"))
        self.assertIsNone(refresh_data.parse_time("00:00"))

    def test_forbidden_url_is_not_called(self):
        with self.assertRaises(RuntimeError):
            refresh_data.fetch("https://www.ffvbbeach.org/ffvbapp/adressier/adressier.php?codent=PTIDF94")
        with self.assertRaises(RuntimeError):
            refresh_data.fetch("https://www.ffvbbeach.org/ffvbapp/resu/ffvolley_fdme.php?codmatch=1")

    def test_ics_time_and_escape(self):
        event = {
            "uid": "demo@volley-app.local",
            "date": "2026-10-03",
            "time": "18:30",
            "summary": "Volley : ASA – Autre",
            "location": "Gymnase A, porte 2",
            "description": "Ligne\nSuite",
        }
        text = volley_data.build_ics([event], "Volley — ASA")
        self.assertIn("BEGIN:VCALENDAR", text)
        self.assertIn("DTSTART:20261003T163000Z", text)
        self.assertIn("DTEND:20261003T183000Z", text)
        self.assertIn(r"Gymnase A\, porte 2", text)
        self.assertNotIn("ffvolley_fdme", text)
        allday = volley_data.build_ics([{
            "uid": "day@volley-app.local",
            "date": "2026-11-15",
            "time": None,
            "summary": "Volley",
            "location": "",
            "description": "Horaire à confirmer.",
        }], "Volley")
        self.assertIn("DTSTART;VALUE=DATE:20261115", allday)
        self.assertIn("DTEND;VALUE=DATE:20261116", allday)

    def test_query_fold(self):
        self.assertTrue(volley_data.query_matches("maison alfort", "ASA Maisons-Alfort"))
        self.assertTrue(volley_data.query_matches("asas", "Ce n’est pas l’ASAS"))

    def test_pages_are_accessible_markup(self):
        html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        css = (ROOT / "static" / "style.css").read_text(encoding="utf-8")
        script = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        self.assertIn('<html lang="fr">', html)
        self.assertIn('href="#contenu"', html)
        self.assertIn('aria-label="Navigation"', html)
        self.assertIn('for="club"', script)
        self.assertIn('for="niveau"', script)
        self.assertIn('for="sexe"', script)
        self.assertIn(":focus-visible", css)
        self.assertIn("text/calendar", (ROOT / "app.py").read_text(encoding="utf-8"))


class DataTests(unittest.TestCase):
    def setUp(self):
        self.path = ROOT / "data" / "94.json"
        if not self.path.exists():
            self.skipTest("data/94.json absent")
        self.blob = json.loads(self.path.read_text(encoding="utf-8"))
        volley_data._CACHE["key"] = None
        self.data = volley_data.load_dataset()

    def test_real_club_and_no_private_sources(self):
        raw = self.path.read_text(encoding="utf-8")
        for banned in ("ffvolley_fdme", "fiche_match", "acces_licences", "saisie_resu", "adressier", "scorenco", "fsgt"):
            self.assertNotIn(banned, raw)
        self.assertIsNone(re_email(raw))
        club = next(item for item in self.blob["clubs"] if item["id"] == "0946822")
        self.assertEqual(club["name"], "Association sportive amicale Maisons-Alfort")
        self.assertEqual(club["short_name"], "ASA VB MA")
        self.assertEqual(club["ffvb_name"], "ASA MAISONS ALFORT")
        self.assertIsNone(club["website"])
        self.assertTrue(any(team["club_id"] == "0946822" for team in self.blob["teams"]))
        self.assertGreater(len(self.blob["matches"]), 0)

    def test_filters(self):
        all_teams = volley_data.list_teams(self.data)
        women = volley_data.list_teams(self.data, sexe="feminin")
        asa = volley_data.list_teams(self.data, club="0946822")
        self.assertGreater(all_teams["total"], women["total"])
        self.assertGreater(asa["total"], 0)
        self.assertTrue(all(card["club_id"] == "0946822" for card in asa["teams"]))
        self.assertTrue(all(card["gender"] == "feminin" for card in women["teams"]))
        found = volley_data.list_teams(self.data, q="maison alfort")
        self.assertTrue(any(card["club_id"] == "0946822" for card in found["teams"]))


def re_email(text: str):
    import re
    return re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", text)


class ServerTests(unittest.TestCase):
    def setUp(self):
        if not (ROOT / "data" / "94.json").exists():
            self.skipTest("data/94.json absent")
        volley_data._CACHE["key"] = None
        self.httpd = app_module.ThreadingHTTPServer(("127.0.0.1", 0), app_module.Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        if hasattr(self, "httpd"):
            self.httpd.shutdown()
            self.httpd.server_close()

    def get(self, path):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}{path}", timeout=10) as response:
            return response.status, response.headers, response.read()

    def test_list_fiche_filter_ics(self):
        status, _headers, body = self.get("/")
        self.assertEqual(status, 200)
        self.assertIn("Volley 94", body.decode("utf-8"))
        status, _headers, body = self.get("/api/clubs/0946822")
        club = json.loads(body.decode("utf-8"))["club"]
        self.assertEqual(club["name"], "Association sportive amicale Maisons-Alfort")
        self.assertIsNone(club["website"])
        status, _headers, body = self.get("/api/equipes?club=0946822&sexe=masculin")
        listed = json.loads(body.decode("utf-8"))
        self.assertGreater(listed["total"], 0)
        self.assertTrue(all(team["gender"] == "masculin" for team in listed["teams"]))
        team_id = listed["teams"][0]["id"]
        status, _headers, body = self.get("/api/equipes/" + team_id)
        detail = json.loads(body.decode("utf-8"))
        self.assertEqual(detail["team"]["id"], team_id)
        self.assertTrue(detail["rankings"])
        status, headers, body = self.get("/calendrier/equipe/" + team_id + ".ics")
        text = body.decode("utf-8")
        self.assertIn("BEGIN:VCALENDAR", text)
        self.assertIn("text/calendar", headers.get("Content-Type"))
        self.assertNotIn("ffvolley_fdme", text)
        match_id = None
        for key in ("upcoming", "played"):
            if detail[key]:
                match_id = detail[key][0]["id"]
                break
        self.assertIsNotNone(match_id)
        status, _headers, body = self.get("/calendrier/match/" + match_id + ".ics")
        self.assertIn("BEGIN:VEVENT", body.decode("utf-8"))
        status, _headers, body = self.get("/api/equipes?niveau=departemental")
        dept = json.loads(body.decode("utf-8"))
        self.assertGreater(dept["total"], 0)
        self.assertTrue(all(team["level"] == "departemental" for team in dept["teams"]))


if __name__ == "__main__":
    unittest.main()
