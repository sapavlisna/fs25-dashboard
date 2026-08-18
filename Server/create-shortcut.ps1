# create-shortcut.ps1 — vyrobí zástupce "FS25 Dashboard" na plochu.
#
# Spusť jednou (pravý klik → Spustit pomocí PowerShellu, nebo z terminálu):
#
#   powershell -ExecutionPolicy Bypass -File create-shortcut.ps1
#
# Zástupce spouští start.bat z téhle složky, takže server poběží se správným
# pracovním adresářem bez ohledu na to, odkud se klikne. Okno s logem zůstává
# otevřené — je to jediné místo, kde je vidět, že server žije a co dělá.
#
# Parametry:
#   -Name      jiný název zástupce (default "FS25 Dashboard")
#   -Path      jiné umístění než plocha (např. složka v Start menu)
#   -NoIcon    přeskočí generování .ico a nechá výchozí ikonu .bat souboru

[CmdletBinding()]
param(
    [string]$Name = 'FS25 Dashboard',
    [string]$Path,
    [switch]$NoIcon
)

$ErrorActionPreference = 'Stop'

$serverDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$startBat  = Join-Path $serverDir 'start.bat'
$icoPath   = Join-Path $serverDir 'dashboard.ico'
$pngPath   = Join-Path (Split-Path -Parent $serverDir) 'FS25\icon_dashboard.png'

if (-not (Test-Path $startBat)) {
    Write-Error "Nenašel jsem start.bat v $serverDir"
    exit 1
}

# ─── Ikona ───────────────────────────────────────────────────────────────────
# Windows bere .ico, mód má jen .png. Skládáme vícevelikostní ICO ručně:
# hlavička + jeden záznam na velikost + samotná PNG data (Vista a novější umí
# PNG uvnitř ICO, takže není potřeba převod do BMP s AND maskou).
#
# Víc velikostí, ne jen 256: Explorer na ploše kreslí 48px, taskbar 32px a
# Alt+Tab 16px, a zmenšování jediné 256px předlohy za běhu dává rozmazaný
# výsledek.
function New-IcoFromPng {
    param([string]$Png, [string]$Ico)

    Add-Type -AssemblyName System.Drawing

    $sizes = @(16, 32, 48, 64, 128, 256)
    $src = [System.Drawing.Image]::FromFile($Png)
    try {
        $blobs = @()
        foreach ($s in $sizes) {
            $bmp = New-Object System.Drawing.Bitmap $s, $s
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            try {
                $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $g.Clear([System.Drawing.Color]::Transparent)
                $g.DrawImage($src, 0, 0, $s, $s)
            } finally { $g.Dispose() }

            $ms = New-Object System.IO.MemoryStream
            $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
            $blobs += ,@($s, $ms.ToArray())
            $ms.Dispose()
            $bmp.Dispose()
        }
    } finally { $src.Dispose() }

    $out = New-Object System.IO.MemoryStream
    $w = New-Object System.IO.BinaryWriter $out
    try {
        $w.Write([UInt16]0)                 # reserved
        $w.Write([UInt16]1)                 # type: 1 = icon
        $w.Write([UInt16]$blobs.Count)

        # Data začínají za hlavičkou (6 B) a všemi záznamy (16 B každý).
        $offset = 6 + (16 * $blobs.Count)
        foreach ($b in $blobs) {
            $size = $b[0]
            $bytes = $b[1]
            # 256 se v jednobajtovém poli zapisuje jako 0 — tak je formát definovaný.
            $dim = 0
            if ($size -lt 256) { $dim = $size }
            $w.Write([Byte]$dim)
            $w.Write([Byte]$dim)
            $w.Write([Byte]0)               # počet barev v paletě (0 = truecolor)
            $w.Write([Byte]0)               # reserved
            $w.Write([UInt16]1)             # color planes
            $w.Write([UInt16]32)            # bits per pixel
            $w.Write([UInt32]$bytes.Length)
            $w.Write([UInt32]$offset)
            $offset += $bytes.Length
        }
        foreach ($b in $blobs) { $w.Write($b[1]) }
        $w.Flush()
        [System.IO.File]::WriteAllBytes($Ico, $out.ToArray())
    } finally { $w.Dispose(); $out.Dispose() }
}

$useIcon = $false
if (-not $NoIcon) {
    if (Test-Path $icoPath) {
        $useIcon = $true
    } elseif (Test-Path $pngPath) {
        try {
            New-IcoFromPng -Png $pngPath -Ico $icoPath
            $useIcon = $true
            Write-Host "  ikona vytvořena: $icoPath"
        } catch {
            Write-Warning "Ikonu se nepodařilo vyrobit ($($_.Exception.Message)) — zástupce dostane výchozí."
        }
    } else {
        Write-Warning "Nenašel jsem $pngPath — zástupce dostane výchozí ikonu."
    }
}

# ─── Zástupce ────────────────────────────────────────────────────────────────
# Cíl je cmd.exe /c, ne přímo .bat: tím zůstane okno otevřené i když server
# spadne při startu (jinak by chybová hláška problikla a zmizela).

if (-not $Path) { $Path = [Environment]::GetFolderPath('Desktop') }
$lnkPath = Join-Path $Path "$Name.lnk"

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath       = "$env:SystemRoot\System32\cmd.exe"
$lnk.Arguments        = "/c `"$startBat`""
$lnk.WorkingDirectory = $serverDir
$lnk.Description      = 'Spustí FS25 Dashboard server (web na http://localhost:3000)'
$lnk.WindowStyle      = 1                     # normální okno — log má být vidět
if ($useIcon) { $lnk.IconLocation = "$icoPath,0" }
$lnk.Save()

Write-Host ""
Write-Host "  Hotovo: $lnkPath"
Write-Host "  Dvojklik spustí server; okno s logem nech otevřené, Ctrl+C ho ukončí."
Write-Host ""
