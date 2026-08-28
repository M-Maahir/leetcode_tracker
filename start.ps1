# Start the local Notion tracker server
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".env")) {
    Write-Host "Missing .env file. Copy .env.example to .env and add your NOTION_TOKEN."
    exit 1
}

if (-not (Test-Path ".venv")) {
    python -m venv .venv
}

& .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python server.py
