#requires -Version 5.1
<#
.SYNOPSIS
    Creates the FS25 Dashboard cloud relay on Render.com.

.DESCRIPTION
    Reads cloud-deploy/.env (copy .env.example as .env and fill in your values),
    creates a Web Service via the Render REST API, polls until the first deploy
    is live, then writes BRIDGE_UPSTREAM_URL + INGEST_TOKEN to ../Server/.env so
    your local server starts pushing data upstream.

.NOTES
    Before first run you need:
      1. A render.com account (free, GitHub login).
      2. A Render API key: dashboard.render.com -> Account Settings -> API Keys.
      3. A fork of sapavlisna/fs25-dashboard (or your own copy) on GitHub.
      4. Render's GitHub App authorized on that repo (one-time UI step).
      5. Copy .env.example to .env and fill the values.

.EXAMPLE
    .\deploy.ps1
#>

[CmdletBinding()]
param(
    [string]$EnvFile = (Join-Path $PSScriptRoot ".env")
)

$ErrorActionPreference = 'Stop'

# ---------- helpers ---------------------------------------------------------

function Write-Step($msg)  { Write-Host ""; Write-Host ">> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "   $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "   $msg" -ForegroundColor Yellow }
function Write-Err2($msg)  { Write-Host "   $msg" -ForegroundColor Red }

function Read-DotEnv([string]$Path) {
    if (-not (Test-Path $Path)) {
        throw ".env not found at $Path. Copy .env.example to .env and fill it in."
    }
    $map = @{}
    foreach ($line in Get-Content -Path $Path) {
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
    $url = "https://api.render.com/v1" + $Path
    if ($Body) {
        $headers['Content-Type'] = 'application/json'
        $json = $Body | ConvertTo-Json -Depth 10 -Compress
        return Invoke-RestMethod -Method $Method -Uri $url -Headers $headers -Body $json
    } else {
        return Invoke-RestMethod -Method $Method -Uri $url -Headers $headers
    }
}

# ---------- load config -----------------------------------------------------

Write-Step "Loading config from $EnvFile"
$cfg = Read-DotEnv $EnvFile

$script:ApiKey      = $cfg['RENDER_API_KEY']
$repoUrl            = $cfg['GITHUB_REPO_URL']
$ingestToken        = $cfg['INGEST_TOKEN']
$serviceName        = if ($cfg['SERVICE_NAME']) { $cfg['SERVICE_NAME'] } else { 'fs25-dashboard' }
$region             = if ($cfg['REGION'])       { $cfg['REGION'] }       else { 'frankfurt' }
$branch             = if ($cfg['BRANCH'])       { $cfg['BRANCH'] }       else { 'main' }

if (-not $script:ApiKey) { throw "RENDER_API_KEY is missing in .env" }
if (-not $repoUrl)       { throw "GITHUB_REPO_URL is missing in .env" }
if ($script:ApiKey -eq 'rnd_REPLACE_ME') { throw "RENDER_API_KEY is still the placeholder. Edit .env first." }

if (-not $ingestToken) {
    $ingestToken = New-RandomToken
    Write-Warn2 "INGEST_TOKEN was empty - generated: $ingestToken"
}

Write-Ok "Service:  $serviceName"
Write-Ok "Repo:     $repoUrl ($branch)"
Write-Ok "Region:   $region"
Write-Ok "Auth:     cloud starts OPEN (set password in local dashboard UI)"

# ---------- verify API key + find owner -------------------------------------

Write-Step "Verifying Render API key"
try {
    $owners = Invoke-Render -Method GET -Path '/owners?limit=20'
} catch {
    throw "Failed to verify Render API key. Check RENDER_API_KEY in .env. Detail: $($_.Exception.Message)"
}
if (-not $owners -or $owners.Count -eq 0) {
    throw "No Render owner found for this API key."
}
$ownerId   = $owners[0].owner.id
$ownerName = $owners[0].owner.name
Write-Ok "Owner: $ownerName ($ownerId)"

# ---------- check if service already exists ---------------------------------

Write-Step "Checking if service '$serviceName' already exists"
$encodedName = [uri]::EscapeDataString($serviceName)
$existing = Invoke-Render -Method GET -Path ("/services?name=" + $encodedName + "&limit=20")
$existingService = $null
foreach ($s in $existing) {
    if ($s.service.name -eq $serviceName -and $s.service.ownerId -eq $ownerId) {
        $existingService = $s.service
        break
    }
}

if ($existingService) {
    Write-Warn2 "Service '$serviceName' already exists (id: $($existingService.id))."
    Write-Warn2 "This script does not recreate it. Change SERVICE_NAME in .env for a fresh deploy."
    $serviceId  = $existingService.id
    $serviceUrl = $existingService.serviceDetails.url
} else {
    # ---------- create service ----------------------------------------------

    Write-Step "Creating a new service on Render (takes ~30s)"

    $envVars = @(
        @{ key = 'INGEST_TOKEN';   value = $ingestToken },
        @{ key = 'NODE_ENV';       value = 'production' },
        @{ key = 'SESSION_SECRET'; generateValue = $true }
    )

    $body = @{
        type             = 'web_service'
        name             = $serviceName
        ownerId          = $ownerId
        repo             = $repoUrl
        branch           = $branch
        autoDeploy       = 'yes'
        rootDir          = 'Server'
        serviceDetails   = @{
            env             = 'node'
            plan            = 'free'
            region          = $region
            healthCheckPath = '/login'
            envSpecificDetails = @{
                buildCommand = 'npm install'
                startCommand = 'node cloud-server.js'
            }
        }
        envVars          = $envVars
    }

    try {
        $created = Invoke-Render -Method POST -Path '/services' -Body $body
    } catch {
        Write-Err2 "Service creation failed. Detail:"
        Write-Err2 $_.Exception.Message
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            Write-Err2 $_.ErrorDetails.Message
        }
        Write-Host ""
        Write-Host "Common causes:" -ForegroundColor Yellow
        Write-Host "  * GITHUB_REPO_URL not linked to Render. Open https://dashboard.render.com/" -ForegroundColor Yellow
        Write-Host "    and in 'New +' -> 'Web Service' authorize the Render GitHub App once on your fork." -ForegroundColor Yellow
        Write-Host "  * SERVICE_NAME is taken by someone else (must be globally unique in subdomain)." -ForegroundColor Yellow
        Write-Host "  * Branch '$branch' does not exist on the remote yet." -ForegroundColor Yellow
        throw
    }

    $serviceId  = $created.service.id
    $serviceUrl = $created.service.serviceDetails.url
    Write-Ok "Created: $serviceId"
    Write-Ok "URL:     $serviceUrl"
}

# ---------- wait for first deploy -------------------------------------------

Write-Step "Waiting for the service to go live (deploy takes ~3 minutes)"
$deadline = (Get-Date).AddMinutes(8)
$lastStatus = ''
while ((Get-Date) -lt $deadline) {
    $info    = Invoke-Render -Method GET -Path ("/services/" + $serviceId)
    $url     = $info.serviceDetails.url
    $deploys = Invoke-Render -Method GET -Path ("/services/" + $serviceId + "/deploys?limit=1")
    $deployStatus = if ($deploys -and $deploys[0]) { $deploys[0].deploy.status } else { 'pending' }

    if ($deployStatus -ne $lastStatus) {
        Write-Ok "Deploy status: $deployStatus"
        $lastStatus = $deployStatus
    }

    if ($deployStatus -eq 'live') {
        Write-Ok "Service is live: $url"
        $serviceUrl = $url
        break
    }
    if ($deployStatus -in @('build_failed','update_failed','canceled','deactivated')) {
        Write-Err2 "Deploy failed ($deployStatus). See logs in the Render dashboard:"
        Write-Err2 ("  https://dashboard.render.com/web/" + $serviceId + "/logs")
        throw "Deploy did not succeed."
    }
    Start-Sleep -Seconds 10
}

# ---------- write back local .env so the local server starts pushing --------

Write-Step "Writing local server config"
$localEnvPath = Resolve-Path (Join-Path $PSScriptRoot "..\Server")
$localEnvFile = Join-Path $localEnvPath ".env"

$wssUrl = $serviceUrl -replace '^https://','wss://'
$wssUrl = $wssUrl.TrimEnd('/') + '/ingest'

$newLines = @(
    ("# Auto-generated by cloud-deploy/deploy.ps1 on " + (Get-Date -Format 'yyyy-MM-dd HH:mm')),
    ("BRIDGE_UPSTREAM_URL=" + $wssUrl),
    ("INGEST_TOKEN=" + $ingestToken)
)

if (Test-Path $localEnvFile) {
    $existing = Get-Content $localEnvFile |
                Where-Object { $_ -notmatch '^(BRIDGE_UPSTREAM_URL|INGEST_TOKEN)=' -and
                               $_ -notmatch '^# Auto-generated by cloud-deploy' }
    Set-Content -Path $localEnvFile -Value (@($existing) + $newLines)
    Write-Ok "Updated: $localEnvFile"
} else {
    Set-Content -Path $localEnvFile -Value $newLines
    Write-Ok "Created: $localEnvFile"
}

# Also persist the generated INGEST_TOKEN back to cloud-deploy/.env so re-runs are stable
$cloudEnvLines = Get-Content $EnvFile
$updated = @()
$tokenWritten = $false
foreach ($line in $cloudEnvLines) {
    if ($line -match '^INGEST_TOKEN=') {
        $updated += ("INGEST_TOKEN=" + $ingestToken)
        $tokenWritten = $true
    } else {
        $updated += $line
    }
}
if (-not $tokenWritten) { $updated += ("INGEST_TOKEN=" + $ingestToken) }
Set-Content -Path $EnvFile -Value $updated

# ---------- done ------------------------------------------------------------

Write-Host ""
Write-Host "=============================================================" -ForegroundColor Green
Write-Host "  DONE" -ForegroundColor Green
Write-Host "=============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Cloud URL:    $serviceUrl" -ForegroundColor White
Write-Host "Auth:         OPEN (set a password in the local dashboard UI when ready)" -ForegroundColor Yellow
Write-Host "Ingest token: $ingestToken" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Start the local dashboard server in another shell:"
Write-Host "       cd ..\Server"
Write-Host "       npm start"
Write-Host "  2. Launch FS25 and load a savegame."
Write-Host "  3. Open the cloud URL in a browser:"
Write-Host "       $serviceUrl"
Write-Host "  4. (Optional) In the LOCAL dashboard open Settings -> Vzdaleny pristup,"
Write-Host "     enable the password and pick one. The cloud URL will require it."
Write-Host "  5. Share the URL (and password if set) with friends."
Write-Host ""
