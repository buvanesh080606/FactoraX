# SmartFactory Local Runner (Strictly on D:\smartbom)
$ErrorActionPreference = "Stop"
$ToolsRoot = "D:\smartbom\.tools"
$env:TEMP = "$ToolsRoot\tmp"
$env:TMP = "$ToolsRoot\tmp"
$env:PATH = "$ToolsRoot\node;$ToolsRoot\pgsql\bin;$env:PATH"

# 1. Ensure PostgreSQL 16 is running on port 5433
$pgStatus = & "$ToolsRoot\pgsql\bin\pg_ctl.exe" -D "$ToolsRoot\pgdata" status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Starting PostgreSQL 16 on 127.0.0.1:5433..."
    & "$ToolsRoot\pgsql\bin\pg_ctl.exe" -D "$ToolsRoot\pgdata" -l "$ToolsRoot\pg.log" start
}

Write-Host "PostgreSQL 16 is running on 127.0.0.1:5433"
Write-Host "Start Backend (ASGI/WebSockets): cd D:\smartbom\backend && .\.venv\Scripts\daphne.exe -b 127.0.0.1 -p 8000 config.asgi:application"
Write-Host "Start Frontend (Vite):           cd D:\smartbom\frontend && D:\smartbom\.tools\node\npm.cmd run dev"
