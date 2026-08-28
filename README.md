# LeetCode / NeetCode → Notion Tracker

Automatically adds a row to your Notion Problem Tracker when you submit a problem on LeetCode or NeetCode.

## How it works

1. A local Python server (`server.py`) receives submission events and writes to Notion.
2. A Tampermonkey userscript watches LeetCode/NeetCode submit traffic and POSTs problem details to that server.

Notion columns used:

| Column               | Type         |
| -------------------- | ------------ |
| `Name`             | title        |
| `Date_Solved`      | date         |
| `Notes`            | rich_text    |
| `Problem_Progress` | select       |
| `Topic`            | multi_select |
| `Difficulty_Level` | select       |

`Problem_Progress` mapping: Accepted → `Completed`, fail states → `Attempted`, otherwise → `In Progress`.

## Setup

### 1. Notion

1. Create a [Notion integration](https://www.notion.so/my-integrations) and copy the token.
2. Share your Problem Tracker database (and parent page if used) with that integration.
3. Copy `.env.example` → `.env` and set `NOTION_TOKEN` and `DATABASE_ID`.

### 2. Install & run the local server

```powershell
cd C:\Users\M_Maahir\Projects\leetcode-notion-tracker
.\start.ps1
```

Or manually:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python server.py
```

Server listens on `http://127.0.0.1:8765`. Keep this terminal open while practicing.

### Deploy to Render

1. Push this repository to GitHub.
2. In [Render](https://render.com/), choose **New → Blueprint** and select the repository.
3. Render detects `render.yaml`. Enter `NOTION_TOKEN`, `PAGE_ID`, and `DATABASE_ID` when prompted.
4. Wait for the service health check at `/health` to pass.
5. If Render assigns a URL other than `https://leetcode-notion-tracker.onrender.com`, update `SERVER_URL` in the userscript with the service URL followed by `/track-problem`, then reinstall or update the Tampermonkey script.

The Render service uses the `PORT` value provided by Render automatically. The free service may sleep after inactivity, so the first request can take a few seconds.

### 3. Install the browser userscript

1. Install [Tampermonkey](https://www.tampermonkey.net/) in Chrome/Edge/Firefox.
2. Create a new script and paste the contents of `userscript/leetcode-notion-tracker.user.js`.
3. Save and enable it.
4. Open a LeetCode or NeetCode problem page — the console should show: `[Notion Tracker] Active`.

## Test

With the server running and the userscript installed, submit any problem. You should see:

- Console: `[Notion Tracker] Logged: ...`
- Server terminal: `Successfully added/updated '...' in Problem Tracker.`
- A new (or updated) row in Notion

Manual API test:

```powershell
curl -X POST http://127.0.0.1:8765/track-problem -H "Content-Type: application/json" -d "{\"name\":\"121. Best Time to Buy and Sell Stock\",\"status\":\"Accepted\",\"difficulty\":\"Easy\",\"topics\":[\"Arrays\",\"Two Pointers\"],\"notes\":\"test\",\"platform\":\"manual\"}"
```

## Notes

- Re-submitting the same problem **updates** the existing Notion row (matched by `Name`) instead of duplicating.
- The Notion token in `.env` is secret — do not commit it (`.gitignore` already excludes `.env`).
- If nothing appears in Notion, check: server running, database shared with the integration, and select option names match (`Completed`, `Easy`, etc.).
