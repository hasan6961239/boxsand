<#
.SYNOPSIS
  NOVA HOST helper for Windows (HP Victus development machine).

.DESCRIPTION
  The project runs identically on Windows and on Termux, so you can develop and
  test the whole platform on the laptop and only deploy to the phone when it
  works. This script covers the same ground as the shell scripts do there.

.EXAMPLE
  .\scripts\dev.ps1 setup      # install nothing, prepare .env and the database
  .\scripts\dev.ps1 start      # run the server (Ctrl+C to stop)
  .\scripts\dev.ps1 test       # run the test suite
  .\scripts\dev.ps1 status     # configuration and health
  .\scripts\dev.ps1 backup     # create a backup archive
  .\scripts\dev.ps1 push       # copy this project to the phone over SSH
#>

[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('setup', 'start', 'dev', 'test', 'status', 'backup', 'reset', 'push', 'help')]
  [string]$Command = 'help',

  # Used by 'push': the phone's address and SSH port as shown by status.sh.
  [string]$PhoneHost = '',
  [int]$PhonePort = 8022,
  [string]$PhoneUser = ''
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

function Write-Info($message) { Write-Host "==> $message" -ForegroundColor Cyan }
function Write-Ok($message) { Write-Host "ok  $message" -ForegroundColor Green }
function Write-Warn($message) { Write-Host "warn $message" -ForegroundColor Yellow }
function Write-Fail($message) { Write-Host "error $message" -ForegroundColor Red; exit 1 }

function Assert-Node {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Write-Fail "Node.js is not installed. Get Node 24 (or 22.5+) from https://nodejs.org"
  }
  $major = [int](node -p 'process.versions.node.split(".")[0]')
  if ($major -lt 22) {
    Write-Fail "Node $major is too old. NOVA HOST needs 22.5 or newer; 24 is recommended."
  }
  Write-Ok "node $(node -v)"
}

function Invoke-Setup {
  Assert-Node
  Push-Location $Root
  try {
    if (-not (Test-Path '.env')) {
      Copy-Item '.env.example' '.env'
      Write-Ok 'created .env'
    }

    $envText = Get-Content '.env' -Raw
    if ($envText -match '(?m)^SESSION_SECRET=\s*$') {
      $secret = node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
      $envText = $envText -replace '(?m)^SESSION_SECRET=.*$', "SESSION_SECRET=$secret"
      # UTF8 without a BOM: the .env parser reads the file as plain text and a
      # BOM would end up inside the first key name.
      [System.IO.File]::WriteAllText((Join-Path $Root '.env'), $envText, (New-Object System.Text.UTF8Encoding $false))
      Write-Ok 'generated SESSION_SECRET'
    }

    Write-Info 'initialising the database'
    node backend/src/cli.js migrate
    Write-Ok 'ready — run: .\scripts\dev.ps1 start'
  }
  finally { Pop-Location }
}

function Invoke-Start([switch]$Watch) {
  Assert-Node
  Push-Location $Root
  try {
    if (-not (Test-Path '.env')) { Write-Fail "No .env yet. Run: .\scripts\dev.ps1 setup" }
    Write-Info 'starting NOVA HOST (Ctrl+C to stop)'
    if ($Watch) { node --watch backend/src/server.js } else { node backend/src/server.js }
  }
  finally { Pop-Location }
}

function Invoke-Tests {
  Assert-Node
  Push-Location $Root
  try {
    node --test "backend/test/**/*.test.js"
    if ($LASTEXITCODE -ne 0) { Write-Fail 'tests failed' }
    Write-Ok 'all tests passed'
  }
  finally { Pop-Location }
}

function Invoke-Status {
  Push-Location $Root
  try {
    node backend/src/cli.js status
    Write-Host ''
    node backend/src/cli.js doctor
  }
  finally { Pop-Location }
}

function Invoke-Backup {
  Push-Location $Root
  try { node backend/src/cli.js backup }
  finally { Pop-Location }
}

function Invoke-Reset {
  Push-Location $Root
  try {
    Write-Warn 'This deletes the local data directory: database, sites and logs.'
    $answer = Read-Host 'Type "reset" to confirm'
    if ($answer -ne 'reset') { Write-Info 'cancelled'; return }
    if (Test-Path 'data') { Remove-Item 'data' -Recurse -Force }
    Write-Ok 'data directory removed; the next start creates a fresh one'
  }
  finally { Pop-Location }
}

function Invoke-Push {
  if (-not $PhoneHost) {
    Write-Fail 'Give the phone address, e.g.: .\scripts\dev.ps1 push -PhoneHost 192.168.1.14 -PhoneUser u0_a123'
  }
  if (-not $PhoneUser) {
    Write-Fail 'Give the Termux user, which "whoami" prints on the phone, e.g. -PhoneUser u0_a123'
  }
  $scp = Get-Command scp -ErrorAction SilentlyContinue
  if (-not $scp) { Write-Fail 'scp not found. Install "OpenSSH Client" from Windows optional features.' }

  $target = "$PhoneUser@$PhoneHost"
  Write-Info "copying the project to ${target}:~/novahost (excluding data and .env)"

  # A staging copy keeps runtime data and secrets on this machine: the phone has
  # its own .env and its own database, and overwriting either would be bad.
  $staging = Join-Path $env:TEMP ("novahost-push-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Path $staging | Out-Null
  try {
    $exclude = @('data', 'node_modules', '.git', '.env')
    Get-ChildItem -Path $Root -Force |
      Where-Object { $exclude -notcontains $_.Name } |
      ForEach-Object { Copy-Item $_.FullName -Destination $staging -Recurse -Force }

    & scp -P $PhonePort -r "$staging/*" "${target}:~/novahost/"
    if ($LASTEXITCODE -ne 0) { Write-Fail 'scp failed' }

    Write-Ok 'copied'
    Write-Host ''
    Write-Host 'Now on the phone (or over SSH):' -ForegroundColor Cyan
    Write-Host "  ssh -p $PhonePort $target"
    Write-Host '  cd ~/novahost && scripts/restart.sh'
  }
  finally {
    Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
  }
}

switch ($Command) {
  'setup' { Invoke-Setup }
  'start' { Invoke-Start }
  'dev' { Invoke-Start -Watch }
  'test' { Invoke-Tests }
  'status' { Invoke-Status }
  'backup' { Invoke-Backup }
  'reset' { Invoke-Reset }
  'push' { Invoke-Push }
  default {
    Write-Host @'
NOVA HOST — Windows helper

  .\scripts\dev.ps1 setup    prepare .env and the database
  .\scripts\dev.ps1 start    run the server
  .\scripts\dev.ps1 dev      run with auto-reload on file changes
  .\scripts\dev.ps1 test     run the test suite
  .\scripts\dev.ps1 status   configuration and health checks
  .\scripts\dev.ps1 backup   create a backup archive
  .\scripts\dev.ps1 reset    delete the local data directory
  .\scripts\dev.ps1 push -PhoneHost 192.168.1.14 -PhoneUser u0_a123

If PowerShell refuses to run this file, allow local scripts for this session:

  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
'@
  }
}
