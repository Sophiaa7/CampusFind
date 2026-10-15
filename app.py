#!/usr/bin/env python3
"""
CampusFind – Backend API
Pure Python (stdlib) + SQLite
Run:  python3 app.py
API:  http://localhost:8080/api/...
Frontend is served from the parent folder.
"""

import json
import os
import re
import sqlite3
import uuid
from datetime import datetime
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from pathlib import Path

# ── Paths ────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent          # campusfind/
DB_PATH = Path(__file__).resolve().parent / "campusfind.db"
PORT = 8080

# ── Database ─────────────────────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    conn = get_db()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS lost (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        category    TEXT NOT NULL,
        date        TEXT NOT NULL,
        location    TEXT NOT NULL,
        description TEXT NOT NULL,
        secret      TEXT DEFAULT '',
        contact     TEXT NOT NULL,
        status      TEXT DEFAULT 'lost',
        created_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS found (
        id          TEXT PRIMARY KEY,
        category    TEXT NOT NULL,
        date        TEXT NOT NULL,
        location    TEXT NOT NULL,
        description TEXT NOT NULL,
        deposit     TEXT NOT NULL,
        contact     TEXT NOT NULL,
        status      TEXT DEFAULT 'found',
        created_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recovered (
        id           TEXT PRIMARY KEY,
        lost_id      TEXT NOT NULL,
        found_id     TEXT NOT NULL,
        item_name    TEXT,
        recovered_at TEXT NOT NULL
    );
    """)
    conn.commit()
    conn.close()

def row_to_dict(row):
    if row is None:
        return None
    return dict(row)

# ── Matching (same logic as original frontend) ───────────────────────────────
def days_between(d1, d2):
    try:
        a = datetime.strptime(d1[:10], "%Y-%m-%d")
        b = datetime.strptime(d2[:10], "%Y-%m-%d")
        return abs((a - b).days)
    except Exception:
        return 999

def match_score(lost, found):
    score = 0
    if lost["category"].lower() == found["category"].lower():
        score += 35
    if lost["location"].lower() == found["location"].lower():
        score += 25
    day_diff = days_between(lost["date"], found["date"])
    if day_diff == 0:
        score += 20
    elif day_diff <= 3:
        score += 15
    elif day_diff <= 7:
        score += 10
    elif day_diff <= 14:
        score += 5
    stop = {"the", "a", "an", "and", "or", "of", "in", "on", "at", "to", "for", "with", "is", "was", "my", "i"}
    lost_text = f"{lost.get('name', '')} {lost.get('description', '')}".lower()
    found_text = (found.get("description") or "").lower()
    lost_words = [w for w in re.split(r"\W+", lost_text) if len(w) > 2 and w not in stop]
    found_words = set(w for w in re.split(r"\W+", found_text) if len(w) > 2)
    hits = sum(1 for w in lost_words if w in found_words)
    if hits >= 3:
        score += 20
    elif hits == 2:
        score += 12
    elif hits == 1:
        score += 6
    return min(100, score)

# ── API handlers ─────────────────────────────────────────────────────────────
def api_stats():
    conn = get_db()
    lost_count = conn.execute("SELECT COUNT(*) FROM lost WHERE status != 'recovered'").fetchone()[0]
    found_count = conn.execute("SELECT COUNT(*) FROM found WHERE status != 'recovered'").fetchone()[0]
    recovered_count = conn.execute("SELECT COUNT(*) FROM recovered").fetchone()[0]
    matches = _compute_matches(conn)
    conn.close()
    return {
        "lost": lost_count,
        "found": found_count,
        "matches": len(matches),
        "recovered": recovered_count,
    }

def _compute_matches(conn):
    lost_rows = [row_to_dict(r) for r in conn.execute("SELECT * FROM lost WHERE status != 'recovered'")]
    found_rows = [row_to_dict(r) for r in conn.execute("SELECT * FROM found WHERE status != 'recovered'")]
    recovered_pairs = set(
        (r["lost_id"], r["found_id"])
        for r in conn.execute("SELECT lost_id, found_id FROM recovered")
    )
    matches = []
    for lost in lost_rows:
        for found in found_rows:
            if (lost["id"], found["id"]) in recovered_pairs:
                continue
            score = match_score(lost, found)
            if score >= 45:
                matches.append({"lost": lost, "found": found, "score": score})
    matches.sort(key=lambda m: m["score"], reverse=True)
    return matches

def api_list_lost():
    conn = get_db()
    rows = [row_to_dict(r) for r in conn.execute("SELECT * FROM lost ORDER BY created_at DESC")]
    conn.close()
    # Never expose secret in list
    for r in rows:
        r.pop("secret", None)
    return rows

def api_list_found():
    conn = get_db()
    rows = [row_to_dict(r) for r in conn.execute("SELECT * FROM found ORDER BY created_at DESC")]
    conn.close()
    return rows

def api_create_lost(data):
    required = ["name", "category", "date", "location", "description", "contact"]
    for k in required:
        if not data.get(k):
            return None, f"Missing field: {k}"
    item = {
        "id": uuid.uuid4().hex[:12],
        "name": data["name"].strip(),
        "category": data["category"],
        "date": data["date"],
        "location": data["location"],
        "description": data["description"].strip(),
        "secret": (data.get("secret") or "").strip(),
        "contact": data["contact"].strip(),
        "status": "lost",
        "created_at": datetime.utcnow().isoformat() + "Z",
    }
    conn = get_db()
    conn.execute(
        """INSERT INTO lost (id, name, category, date, location, description, secret, contact, status, created_at)
           VALUES (:id, :name, :category, :date, :location, :description, :secret, :contact, :status, :created_at)""",
        item,
    )
    conn.commit()
    conn.close()
    public = dict(item)
    public.pop("secret", None)
    return public, None

def api_create_found(data):
    required = ["category", "date", "location", "description", "deposit", "contact"]
    for k in required:
        if not data.get(k):
            return None, f"Missing field: {k}"
    item = {
        "id": uuid.uuid4().hex[:12],
        "category": data["category"],
        "date": data["date"],
        "location": data["location"],
        "description": data["description"].strip(),
        "deposit": data["deposit"].strip(),
        "contact": data["contact"].strip(),
        "status": "found",
        "created_at": datetime.utcnow().isoformat() + "Z",
    }
    conn = get_db()
    conn.execute(
        """INSERT INTO found (id, category, date, location, description, deposit, contact, status, created_at)
           VALUES (:id, :category, :date, :location, :description, :deposit, :contact, :status, :created_at)""",
        item,
    )
    conn.commit()
    conn.close()
    return item, None

def api_matches():
    conn = get_db()
    matches = _compute_matches(conn)
    # Strip secrets from lost items in response
    for m in matches:
        m["lost"].pop("secret", None)
    conn.close()
    return matches

def api_verify(data):
    lost_id = data.get("lostId") or data.get("lost_id")
    found_id = data.get("foundId") or data.get("found_id")
    secret_input = (data.get("secret") or "").strip().lower()
    if not lost_id or not found_id:
        return None, "lostId and foundId required"
    conn = get_db()
    lost = row_to_dict(conn.execute("SELECT * FROM lost WHERE id = ?", (lost_id,)).fetchone())
    found = row_to_dict(conn.execute("SELECT * FROM found WHERE id = ?", (found_id,)).fetchone())
    if not lost or not found:
        conn.close()
        return None, "Item not found"
    if lost["status"] == "recovered" or found["status"] == "recovered":
        conn.close()
        return None, "Already recovered"
    stored = (lost.get("secret") or "").strip().lower()
    # If no secret was set, accept any non-empty input
    ok = (stored == "" and len(secret_input) > 0) or (secret_input == stored)
    if not ok:
        conn.close()
        return None, "Incorrect verification detail"
    # Mark recovered
    conn.execute("UPDATE lost SET status = 'recovered' WHERE id = ?", (lost_id,))
    conn.execute("UPDATE found SET status = 'recovered' WHERE id = ?", (found_id,))
    rec = {
        "id": uuid.uuid4().hex[:12],
        "lost_id": lost_id,
        "found_id": found_id,
        "item_name": lost.get("name"),
        "recovered_at": datetime.utcnow().isoformat() + "Z",
    }
    conn.execute(
        "INSERT INTO recovered (id, lost_id, found_id, item_name, recovered_at) VALUES (:id, :lost_id, :found_id, :item_name, :recovered_at)",
        rec,
    )
    conn.commit()
    conn.close()
    return {"ok": True, "recovered": rec}, None

def api_seed():
    """Load demo data (replaces existing)."""
    conn = get_db()
    conn.execute("DELETE FROM recovered")
    conn.execute("DELETE FROM lost")
    conn.execute("DELETE FROM found")
    now = datetime.utcnow().isoformat() + "Z"
    lost_items = [
        ("iphone13", "iPhone 13 (Blue case)", "Electronics", "2025-10-08", "Library",
         "Black iPhone 13 with a matte blue silicone case and a cracked screen protector. Last seen near the reading tables.",
         "blue case", "0803XXXXXXX"),
        ("idcard01", "Student ID Card – CS 2021", "Identification cards", "2025-10-10", "Lecture theatre",
         "Student ID card, Computer Science, matric number ending 2147. Blue lanyard attached.",
         "2147", "you@student.edu.ng"),
        ("wallet01", "Black leather wallet", "Wallets", "2025-10-05", "Cafeteria",
         "Black bifold leather wallet containing ATM cards and a few receipts. No cash left.",
         "ATM card ends 8891", "0706XXXXXXX"),
    ]
    for lid, name, cat, date, loc, desc, secret, contact in lost_items:
        conn.execute(
            "INSERT INTO lost VALUES (?,?,?,?,?,?,?,?,?,?)",
            (lid, name, cat, date, loc, desc, secret, contact, "lost", now),
        )
    found_items = [
        ("fphone1", "Electronics", "2025-10-09", "Library",
         "Found a black smartphone with a blue case near the second-floor reading area. Screen has a protector that looks cracked.",
         "Library Front Desk", "library@campus.edu.ng"),
        ("fidcard", "Identification cards", "2025-10-10", "Lecture theatre",
         "Picked up a student ID card with a blue lanyard after the morning lecture in LT1.",
         "With me – contact to arrange pickup", "0812XXXXXXX"),
        ("fkeys01", "Keys", "2025-10-11", "Hostel",
         "Set of three keys on a metal ring with a small red plastic tag.",
         "Hostel porter desk", "porter@hostel.edu.ng"),
    ]
    for fid, cat, date, loc, desc, deposit, contact in found_items:
        conn.execute(
            "INSERT INTO found VALUES (?,?,?,?,?,?,?,?,?)",
            (fid, cat, date, loc, desc, deposit, contact, "found", now),
        )
    conn.commit()
    conn.close()
    return {"ok": True, "message": "Demo data loaded"}

# ── HTTP Handler ─────────────────────────────────────────────────────────────
class CampusFindHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        if path == "/api/stats":
            self._send_json(api_stats())
        elif path == "/api/lost":
            self._send_json(api_list_lost())
        elif path == "/api/found":
            self._send_json(api_list_found())
        elif path == "/api/matches":
            self._send_json(api_matches())
        elif path.startswith("/api/"):
            self._send_json({"error": "Not found"}, 404)
        else:
            # Serve static files (index.html, js/, etc.)
            if path == "/":
                self.path = "/index.html"
            return SimpleHTTPRequestHandler.do_GET(self)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        data = self._read_json()

        if path == "/api/lost":
            result, err = api_create_lost(data)
            if err:
                self._send_json({"error": err}, 400)
            else:
                self._send_json(result, 201)
        elif path == "/api/found":
            result, err = api_create_found(data)
            if err:
                self._send_json({"error": err}, 400)
            else:
                self._send_json(result, 201)
        elif path == "/api/verify":
            result, err = api_verify(data)
            if err:
                self._send_json({"error": err}, 400)
            else:
                self._send_json(result)
        elif path == "/api/seed":
            self._send_json(api_seed())
        else:
            self._send_json({"error": "Not found"}, 404)

    def log_message(self, format, *args):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {args[0]}")


def main():
    init_db()
    print("=" * 50)
    print("  CampusFind API + Frontend")
    print(f"  http://localhost:{PORT}")
    print("=" * 50)
    print("  API endpoints:")
    print("    GET  /api/stats")
    print("    GET  /api/lost")
    print("    GET  /api/found")
    print("    GET  /api/matches")
    print("    POST /api/lost")
    print("    POST /api/found")
    print("    POST /api/verify")
    print("    POST /api/seed   (load demo data)")
    print("=" * 50)
    server = HTTPServer(("0.0.0.0", PORT), CampusFindHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
