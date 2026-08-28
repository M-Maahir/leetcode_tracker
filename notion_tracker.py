"""Notion API helpers for the LeetCode / NeetCode problem tracker."""

from __future__ import annotations

import os
from datetime import date

import requests
from dotenv import load_dotenv

load_dotenv()

NOTION_TOKEN = os.environ["NOTION_TOKEN"]
PAGE_ID = os.getenv("PAGE_ID", "")
DATABASE_ID = os.environ["DATABASE_ID"]

HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28",
}


def update_parent_page_title(new_title: str) -> None:
    """Updates the main Notion page title."""
    if not PAGE_ID:
        return

    url = f"https://api.notion.com/v1/pages/{PAGE_ID}"
    payload = {
        "properties": {
            "title": [{"text": {"content": new_title}}]
        }
    }
    res = requests.patch(url, headers=HEADERS, json=payload, timeout=30)
    print("Page Title Update Status:", res.status_code)
    if res.status_code != 200:
        print("Page Title Error:", res.text)


def append_text_to_page(text_content: str) -> None:
    """Appends a paragraph block to the bottom of the main Notion page."""
    if not PAGE_ID:
        return

    url = f"https://api.notion.com/v1/blocks/{PAGE_ID}/children"
    payload = {
        "children": [
            {
                "object": "block",
                "type": "paragraph",
                "paragraph": {
                    "rich_text": [{"type": "text", "text": {"content": text_content}}]
                },
            }
        ]
    }
    res = requests.patch(url, headers=HEADERS, json=payload, timeout=30)
    print("Block Append Status:", res.status_code)
    if res.status_code != 200:
        print("Block Append Error:", res.text)


def _query_existing_by_name(name: str) -> str | None:
    """Return page id if a row with the same Name already exists."""
    url = f"https://api.notion.com/v1/databases/{DATABASE_ID}/query"
    payload = {
        "filter": {
            "property": "Name",
            "title": {"equals": name},
        }
    }
    res = requests.post(url, headers=HEADERS, json=payload, timeout=30)
    if res.status_code != 200:
        print("Database query error:", res.text)
        return None

    results = res.json().get("results", [])
    if not results:
        return None
    return results[0]["id"]


def add_problem_to_tracker(
    name: str,
    date_solved: str,
    notes: str,
    progress: str,
    topics: list[str],
    difficulty: str,
    *,
    update_if_exists: bool = True,
) -> dict:
    """Add or update a row in the Problem Tracker database."""
    existing_id = _query_existing_by_name(name)

    properties = {
        "Name": {"title": [{"text": {"content": name}}]},
        "Date_Solved": {"date": {"start": date_solved}},
        "Notes": {"rich_text": [{"text": {"content": notes[:2000]}}]},
        "Problem_Progress": {"select": {"name": progress}},
        "Topic": {"multi_select": [{"name": t} for t in topics if t]},
        "Difficulty_Level": {"select": {"name": difficulty}},
    }

    if existing_id and update_if_exists:
        url = f"https://api.notion.com/v1/pages/{existing_id}"
        res = requests.patch(url, headers=HEADERS, json={"properties": properties}, timeout=30)
        action = "updated"
    else:
        url = "https://api.notion.com/v1/pages"
        payload = {
            "parent": {"database_id": DATABASE_ID},
            "properties": properties,
        }
        res = requests.post(url, headers=HEADERS, json=payload, timeout=30)
        action = "added"

    if res.status_code == 200:
        print(f"Successfully {action} '{name}' in Problem Tracker.")
        return {"ok": True, "action": action, "name": name}

    print(f"Error {action} entry ({res.status_code}):", res.text)
    return {"ok": False, "status_code": res.status_code, "error": res.text}


def map_submission_status(status: str) -> str:
    """Map platform submission status to Notion Problem_Progress select values."""
    normalized = (status or "").strip().lower()
    if normalized in {"accepted", "ac"}:
        return "Completed"
    if normalized in {"wrong answer", "time limit exceeded", "runtime error", "compile error"}:
        return "Attempted"
    return "In Progress"
