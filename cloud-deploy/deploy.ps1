#requires -Version 5.1
<#
.SYNOPSIS
    Vytvoří FS25 Dashboard cloud relay na Render.com.

.DESCRIPTION
    Skript načte konfiguraci z .env (zkopíruj .env.example jako .env a vyplň),
    vytvoří Web Service přes Render REST API, počká na první deploy,
    a zapíše BRIDGE_UPSTREAM_URL + INGEST_TOKEN do ../Server/.env aby tvůj
    lokální server začal posílat data do cloudu.

.NOTES
    Před prvním spuštěním musíš:
      1. Mít účet na render.com (zdarma, jen GitHub login).
      2. Vytvořit API key: dashboard.render.com → Account Settings → API Keys.
      3. Forknout https://github.com/Sapavlisna/fs25-dashboard na svůj GitHub.
      4. V Render UI připojit svůj GitHub účet jednou (Render OAuth).
      5. Zkopírovat .env.example jako .env a vyplnit.

.EXAMPLE
    .\deploy.ps1
#>

[CmdletBinding()]
param(
    [string]$EnvFile = (Join-Path $PSScriptRoot ".env")
)

$ErrorActionPreference = 'Stop'

# ─── Helpers ─────────────────────────────────────────────────────────────────

function Write-Step($msg)    { Write-Host ""; Write-Host ">> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)      { Write-Host "   $msg" -ForegroundColor Green }
function Write-Warn2($msg)   { Write-Host "   $msg" -ForegroundColor Yellow }
function Write-Err($msg)     { Write-Host "   $msg" -ForegroundColor Red }

function Read-DotEnv([string]$Path) {
    if (-not (Test-Path $Path)) {
        throw "Soubor .env nenalezen ($Path). Zkopíruj .env.example jako .env a vyplň hodnoty."
    }
    $map = @{}
    foreach ($line in Get-Content -Path $Path -Encoding UTF8) {
        $t = $line.Trim()
        if (-not $t -or $t.StartsWith('#')) { continue }
        $eq = $t.IndexOf('=')
        if ($eq -lt 0) { continue }
        $k = $t.Substring(0, $eq).Trim()
        $v = $t.Substring($eq + 1).Trim().Trim('"')
        $map[$k] = $v
    }
    return $map
}

function New-RandomToken([int]$Bytes = 24) {
    $buf = New-Object byte[] $Bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
    return [Convert]::ToBase64String($buf).TrimEnd('=').Replace('+','-').Replace('/','_')
}

function Invoke-Render($Method, $Path, $Body = $null) {
    $headers = @{
        'Authorization' = "Bearer $($script:ApiKey)"
        'Accept'        = 'application/json'
    }
    $url = "https://api.render.com/v1$Path"
    if ($Body) {
        $headers['Content-Type'] = 'application/json'
        $json = $Body | ConvertTo-Json -Depth 10 -Compress
        return Invoke-RestMethod -Method $Method -Uri $url -Headers $headers -Body $json
    } else {
        return Invoke-RestMethod -Method $Method -Uri $url -Headers $headers
    }
}

# ─── Load config ─────────────────────────────────────────────────────────────

Write-Step "Načítám konfiguraci z $EnvFile"
$cfg = Read-DotEnv $EnvFile

$script:ApiKey      = $cfg['RENDER_API_KEY']
$repoUrl            = $cfg['GITHUB_REPO_URL']
$dashboardPassword  = $cfg['DASHBOARD_PASSWORD']
$ingestToken        = $cfg['INGEST_TOKEN']
$serviceName        = if ($cfg['SERVICE_NAME']) { $cfg['SERVICE_NAME'] } else { 'fs25-dashboard' }
$region             = if ($cfg['REGION']) { $cfg['REGION'] } else { 'frankfurt' }
$branch             = if ($cfg['BRANCH']) { $cfg['BRANCH'] } else { 'main' }

if (-not $script:ApiKey) { throw "RENDER_API_KEY není vyplněno v .env" }
if (-not $repoUrl)       { throw "GITHUB_REPO_URL není vyplněno v .env" }

if (-not $ingestToken) {
    $ingestToken = New-RandomToken
    Write-Warn2 "INGEST_TOKEN nebyl zadán — vygenerován: $ingestToken"
}

Write-Ok "Service:  $serviceName"
Write-Ok "Repo:     $repoUrl ($branch)"
Write-Ok "Region:   $region"
Write-Ok "Heslo:    $(if ($dashboardPassword) { 'nastaveno' } else { 'PRÁZDNÉ (veřejný přístup!)' })"

# ─── Verify API key + find owner ─────────────────────────────────────────────

Write-Step "Ověřuji Render API klíč"
try {
    $owners = Invoke-Render -Method GET -Path '/owners?limit=20'
} catch {
    throw "Nepodařilo se ověřit Render API klíč. Zkontroluj RENDER_API_KEY v .env. Detail: $($_.Exception.Message)"
}
if (-not $owners -or $owners.Count -eq 0) {
    throw "Žádný Render owner nebyl nalezen pro tento API klíč."
}
$ownerId = $owners[0].owner.id
$ownerName = $owners[0].owner.name
Write-Ok "Owner: $ownerName ($ownerId)"

# ─── Check if service already exists ─────────────────────────────────────────

Write-Step "Kontroluji, jestli služba '$serviceName' už existuje"
$existing = Invoke-Render -Method GET -Path "/services?name=$serviceName&limit=20"
$existingService = $null
foreach ($s in $existing) {
    if ($s.service.name -eq $serviceName -and $s.service.ownerId -eq $ownerId) {
        $existingService = $s.service
        break
    }
}

if ($existingService) {
    Write-Warn2 "Služba '$serviceName' už existuje (id: $($existingService.id))."
    Write-Warn2 "Tento skript ji znovu nevytváří. Pokud chceš jiné jméno, změň SERVICE_NAME v .env."
    Write-Warn2 "Pokud chceš jen aktualizovat env vars, použij update-env.ps1."
    $serviceId = $existingService.id
    $serviceUrl = $existingService.serviceDetails.url
} else {
    # ─── Create service ──────────────────────────────────────────────────────

    Write-Step "Vytvářím novou službu na Renderu (může trvat ~30 s)"

    $envVars = @(
        @{ key = 'INGEST_TOKEN';       value = $ingestToken },
        @{ key = 'DASHBOARD_PASSWORD'; value = $dashboardPassword },
        @{ key = 'NODE_ENV';           value = 'production' },
        @{ key = 'SESSION_SECRET';     generateValue = $true }
    )

    $body = @{
        type             = 'web_service'
        name             = $serviceName
        ownerId          = $ownerId
        repo             = $repoUrl
        branch           = $branch
        autoDeploy       = 'yes'
        rootDir          = 'src/Dashboard/Server'
        serviceDetails   = @{
            env              = 'node'
            plan             = 'free'
            region           = $region
            buildCommand     = 'npm install'
            startCommand     = 'node cloud-server.js'
            healthCheckPath  = '/login'
            envSpecificDetails = @{}
        }
        envVars          = $envVars
    }

    try {
        $created = Invoke-Render -Method POST -Path '/services' -Body $body
    } catch {
        Write-Err "Vytvoření služby selhalo. Detail:"
        Write-Err $_.Exception.Message
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            Write-Err $_.ErrorDetails.Message
        }
        Write-Host ""
        Write-Host "Časté příčiny:" -ForegroundColor Yellow
        Write-Host "  • GITHUB_REPO_URL nemá Render připojený. Otevři https://dashboard.render.com/" -ForegroundColor Yellow
        Write-Host "    a v 'New +' → 'Web Service' jednou autorizuj GitHub pro svůj fork."  -ForegroundColor Yellow
        Write-Host "  • SERVICE_NAME už používá někdo jiný (musí být globálně unikátní v subdoméně)." -ForegroundColor Yellow
        throw
    }

    $serviceId = $created.service.id
    $serviceUrl = $created.service.serviceDetails.url
    Write-Ok "Vytvořeno: $serviceId"
    Write-Ok "URL:       $serviceUrl"
}

# ─── Wait for first deploy ───────────────────────────────────────────────────

Write-Step "Čekám, až bude služba živá (deploy trvá ~3 min)"
$deadline = (Get-Date).AddMinutes(8)
$lastStatus = ''
while ((Get-Date) -lt $deadline) {
    $info = Invoke-Render -Method GET -Path "/services/$serviceId"
    $status = $info.suspended
    $url    = $info.serviceDetails.url
    $deploys = Invoke-Render -Method GET -Path "/services/$serviceId/deploys?limit=1"
    $deployStatus = if ($deploys -and $deploys[0]) { $deploys[0].deploy.status } else { 'pending' }

    if ($deployStatus -ne $lastStatus) {
        Write-Ok "Deploy status: $deployStatus"
        $lastStatus = $deployStatus
    }

    if ($deployStatus -eq 'live') {
        Write-Ok "Služba je živá: $url"
        $serviceUrl = $url
        break
    }
    if ($deployStatus -in @('build_failed','update_failed','canceled','deactivated')) {
        Write-Err "Deploy selhal ($deployStatus). Podívej se na logy v Render dashboardu:"
        Write-Err "  https://dashboard.render.com/web/$serviceId/logs"
        throw "Deploy se nepovedl."
    }
    Start-Sleep -Seconds 10
}

# ─── Write local .env so the local server starts pushing ─────────────────────

Write-Step "Zapisuji konfiguraci pro lokální server"
$localEnvPath = Resolve-Path (Join-Path $PSScriptRoot "..\Server")
$localEnvFile = Join-Path $localEnvPath ".env"

$wssUrl = $serviceUrl -replace '^https://','wss://'
$wssUrl = $wssUrl.TrimEnd('/') + '/ingest'

$newLines = @(
    "# Auto-generated by cloud-deploy/deploy.ps1 on $(Get-Date -Format 'yyyy-MM-dd HH:mm')",
    "BRIDGE_UPSTREAM_URL=$wssUrl",
    "INGEST_TOKEN=$ingestToken"
)

if (Test-Path $localEnvFile) {
    $existing = Get-Content $localEnvFile -Encoding UTF8 |
                Where-Object { $_ -notmatch '^(BRIDGE_UPSTREAM_URL|INGEST_TOKEN)=' -and
                               $_ -notmatch '^# Auto-generated by cloud-deploy' }
    Set-Content -Path $localEnvFile -Value (@($existing) + $newLines) -Encoding UTF8
    Write-Ok "Aktualizováno: $localEnvFile"
} else {
    Set-Content -Path $localEnvFile -Value $newLines -Encoding UTF8
    Write-Ok "Vytvořeno: $localEnvFile"
}

# ─── Done ────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "═════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  HOTOVO" -ForegroundColor Green
Write-Host "═════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "Cloud URL:    $serviceUrl" -ForegroundColor White
if ($dashboardPassword) {
    Write-Host "Heslo:        $dashboardPassword" -ForegroundColor White
} else {
    Write-Host "Heslo:        (žádné — kdokoliv s URL může otevřít)" -ForegroundColor Yellow
}
Write-Host "Ingest token: $ingestToken" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Další kroky:" -ForegroundColor Cyan
Write-Host "  1. Spusť lokální dashboard server:  cd ..\Server && npm start"
Write-Host "  2. Zapni FS25 a načti savegame."
Write-Host "  3. Otevři v prohlížeči:  $serviceUrl"
Write-Host "  4. Pošli URL + heslo kamarádům."
Write-Host ""
