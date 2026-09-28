#!/usr/bin/env python3
"""Serveur local de Volley 94. Bibliothèque standard uniquement."""

from __future__ import annotations

import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import volley_data

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
INDEX = STATIC / "index.html"


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        query = {key: values[0] for key, values in parse_qs(parsed.query).items() if values}
        try:
            if path.startswith("/api/"):
                self._api(path, query)
            elif path.startswith("/calendrier/"):
                self._ics(path)
            elif path.startswith("/static/"):
                self._static(path[len("/static/"):])
            elif self._is_page(path):
                self._file(INDEX, "text/html; charset=utf-8")
            else:
                self._text("Page introuvable.", 404)
        except FileNotFoundError as exc:
            self._json({"error": str(exc)}, 500)
        except Exception as exc:  # une erreur de lecture ne doit pas tuer le serveur
            self._json({"error": f"Lecture impossible : {exc}"}, 500)

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)

    def _is_page(self, path: str) -> bool:
        return path in {"/", "/clubs"} or bool(
            re.fullmatch(r"/clubs/\d+", path)
            or re.fullmatch(r"/equipes/[A-Za-z0-9_-]+", path)
            or re.fullmatch(r"/matchs/[A-Za-z0-9_-]+", path)
        )

    def _api(self, path: str, query: dict):
        data = volley_data.load_dataset()
        if path == "/api/meta":
            self._json(volley_data.meta(data))
            return
        if path == "/api/clubs":
            self._json(volley_data.list_clubs(data))
            return
        if path == "/api/equipes":
            self._json(volley_data.list_teams(
                data,
                club=query.get("club", ""),
                niveau=query.get("niveau", ""),
                sexe=query.get("sexe", ""),
                q=query.get("q", ""),
                ids=query.get("ids", ""),
            ))
            return
        club = re.fullmatch(r"/api/clubs/(\d+)", path)
        if club:
            detail = volley_data.club_detail(data, club.group(1))
            self._json(detail if detail else {"error": "Club introuvable."}, 200 if detail else 404)
            return
        team = re.fullmatch(r"/api/equipes/([A-Za-z0-9_-]+)", path)
        if team:
            detail = volley_data.team_detail(data, team.group(1))
            self._json(detail if detail else {"error": "Équipe introuvable."}, 200 if detail else 404)
            return
        match = re.fullmatch(r"/api/matchs/([A-Za-z0-9_-]+)", path)
        if match:
            detail = volley_data.match_detail(data, match.group(1))
            self._json(detail if detail else {"error": "Match introuvable."}, 200 if detail else 404)
            return
        self._json({"error": "Adresse inconnue."}, 404)

    def _ics(self, path: str):
        data = volley_data.load_dataset()
        team = re.fullmatch(r"/calendrier/equipe/([A-Za-z0-9_-]+)\.ics", path)
        match = re.fullmatch(r"/calendrier/match/([A-Za-z0-9_-]+)\.ics", path)
        if team:
            built = volley_data.team_ics(data, team.group(1))
        elif match:
            built = volley_data.match_ics(data, match.group(1))
        else:
            built = None
        if not built:
            self._text("Calendrier introuvable.", 404)
            return
        body, filename = built
        raw = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/calendar; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(raw)

    def _static(self, rel: str):
        root = STATIC.resolve()
        path = (root / rel).resolve()
        inside = path == root or root in path.parents
        if not inside or not path.is_file():
            self._text("Fichier introuvable.", 404)
            return
        kind = {
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".svg": "image/svg+xml",
            ".html": "text/html; charset=utf-8",
        }.get(path.suffix, "application/octet-stream")
        self._file(path, kind)

    def _file(self, path: Path, content_type: str):
        raw = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(raw)

    def _json(self, payload, status=200):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _text(self, message: str, status: int):
        raw = message.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def serve(host="127.0.0.1", port=8765):
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"Volley 94 : http://{host}:{port}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    import sys
    chosen = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    serve(port=chosen)
