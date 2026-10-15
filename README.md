# CampusFind – Smart Lost & Found Platform for University Communities

A full-stack Minimum Viable Product (MVP) with a Python backend and SQLite database.

## Features
- Report Lost Item (with private verification detail)
- Report Found Item
- Search & filter reports
- Smart matching (category + location + date proximity + keyword overlap)
- Ownership verification flow
- Status tracking (Lost → Possible Match → Recovered)
- Responsive design (mobile + desktop)
- **Backend API** with SQLite persistence
- Offline fallback to localStorage if the server is not running

## Project structure
```
campusfind/
├── index.html          # Frontend UI
├── js/app.js           # Frontend logic (calls API)
├── server/
│   └── app.py          # Python backend (stdlib + SQLite)
└── README.md
```

## How to run (with backend)

```bash
cd campusfind
python3 server/app.py
```

Then open **http://localhost:5000** in your browser.

The same process serves both the API and the static frontend.

### API endpoints
| Method | Path           | Description                |
|--------|----------------|----------------------------|
| GET    | /api/stats     | Platform counts            |
| GET    | /api/lost      | List lost reports          |
| GET    | /api/found     | List found reports         |
| GET    | /api/matches   | Possible matches           |
| POST   | /api/lost      | Create lost report         |
| POST   | /api/found     | Create found report        |
| POST   | /api/verify    | Verify ownership + recover |
| POST   | /api/seed      | Load demo sample data      |

## Demo tip for presentation
1. Click **Load sample demo data** on the home page (or `POST /api/seed`).
2. Go to **Matches** – you will see high-confidence pairs.
3. Click **Verify Ownership** and enter the secret (`blue case` or `2147`).
4. Item is marked Recovered.

## Tech stack
- **Frontend:** HTML5, Tailwind CSS (CDN), Vanilla JavaScript
- **Backend:** Python 3 (stdlib `http.server` + `sqlite3`) – no extra packages required
- **Database:** SQLite (`server/campusfind.db`, created automatically)

## Offline / pure frontend mode
If you open `index.html` directly (file://) or the Python server is not running, the app automatically falls back to browser `localStorage`. All features still work for demos.
