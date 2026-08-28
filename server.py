"""
Local webhook server for the Tampermonkey userscript.

Run:
    python server.py

The userscript POSTs submission events to http://127.0.0.1:8765/track-problem
"""

from __future__ import annotations

import os
from datetime import date
from typing import Any

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from notion_tracker import add_problem_to_tracker, map_submission_status

load_dotenv()

PORT = int(os.getenv("SERVER_PORT", "8765"))

app = FastAPI(title="LeetCode Notion Tracker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://leetcode.com",
        "https://www.leetcode.com",
        "https://neetcode.io",
        "https://www.neetcode.io",
    ],
    allow_credentials=False,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


class ProblemPayload(BaseModel):
    name: str = Field(..., description="Problem title, e.g. '121. Best Time to Buy and Sell Stock'")
    status: str = Field(default="Accepted", description="Submission status from the platform")
    difficulty: str = Field(default="Unknown")
    topics: list[str] = Field(default_factory=list)
    notes: str = Field(default="")
    platform: str = Field(default="leetcode")
    submission_id: str | None = None
    problem_url: str | None = None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/track-problem")
def track_problem(payload: ProblemPayload) -> dict[str, Any]:
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="name is required")

    progress = map_submission_status(payload.status)
    today = date.today().isoformat()

    notes_parts = []
    if payload.notes:
        notes_parts.append(payload.notes)
    if payload.problem_url:
        notes_parts.append(f"URL: {payload.problem_url}")
    if payload.submission_id:
        notes_parts.append(f"Submission: {payload.submission_id}")
    notes_parts.append(f"Platform: {payload.platform}")
    notes_parts.append(f"Status: {payload.status}")

    result = add_problem_to_tracker(
        name=payload.name.strip(),
        date_solved=today,
        notes="\n".join(notes_parts),
        progress=progress,
        topics=payload.topics,
        difficulty=payload.difficulty or "Unknown",
    )

    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "Notion API error"))

    return result


if __name__ == "__main__":
    print(f"LeetCode/NeetCode Notion tracker listening on http://127.0.0.1:{PORT}")
    print("Install the Tampermonkey userscript, then submit a problem to test.")
    uvicorn.run("server:app", host="127.0.0.1", port=PORT, reload=False)
