# Shared incremental thumbnail cache (SHA-256 of source bytes).
# Used by build-projects.ps1 and build-gallery.ps1

$script:ThumbCacheFileName = ".thumb-cache.json"

function Get-ThumbFileName([string] $fileKey) {
    $key = $fileKey -replace "\\", "/"
    $md5 = [System.Security.Cryptography.MD5]::Create()
    $hash = $md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($key))
    $sb = New-Object System.Text.StringBuilder
    for ($i = 0; $i -lt 7 -and $i -lt $hash.Length; $i++) {
        [void]$sb.AppendFormat("{0:x2}", $hash[$i])
    }
    return $sb.ToString() + ".jpg"
}

function Get-SourceFileSha256([string] $Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-ThumbCacheHashtable([string] $ThumbsDir) {
    $cachePath = Join-Path $ThumbsDir $script:ThumbCacheFileName
    $ht = @{}
    if (-not (Test-Path -LiteralPath $cachePath)) { return $ht }
    try {
        $parsed = Get-Content -LiteralPath $cachePath -Raw | ConvertFrom-Json
        if ($parsed.entries) {
            foreach ($prop in $parsed.entries.PSObject.Properties) {
                $ht[$prop.Name] = [string]$prop.Value
            }
        }
    }
    catch {
        Write-Warning "Could not read thumb cache at $cachePath : $_"
    }
    return $ht
}

function Set-ThumbCacheHashtable([string] $ThumbsDir, [hashtable] $Entries) {
    if (-not (Test-Path -LiteralPath $ThumbsDir)) {
        New-Item -ItemType Directory -Path $ThumbsDir -Force | Out-Null
    }
    $payload = [ordered]@{
        version = 1
        entries = $Entries
    }
    $cachePath = Join-Path $ThumbsDir $script:ThumbCacheFileName
    $json = ($payload | ConvertTo-Json -Depth 4) + "`n"
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($cachePath, $json, $utf8NoBom)
}

function Test-ThumbIsFresh([string] $SrcPath, [string] $DestPath, [string] $CacheKey, [hashtable] $Cache) {
    if (-not $Cache.ContainsKey($CacheKey)) { return $false }
    if (-not (Test-Path -LiteralPath $DestPath)) { return $false }
    try {
        return (Get-SourceFileSha256 $SrcPath) -eq $Cache[$CacheKey]
    }
    catch {
        return $false
    }
}

function Update-ThumbCacheKeys([hashtable] $Cache, [string[]] $ActiveKeys) {
    $active = [System.Collections.Generic.HashSet[string]]::new([string[]]$ActiveKeys)
    foreach ($key in @($Cache.Keys)) {
        if (-not $active.Contains($key)) {
            $null = $Cache.Remove($key)
        }
    }
}

function Remove-OrphanThumbFiles([string] $ThumbsDir, [System.Collections.Generic.HashSet[string]] $KeepDestNames) {
    if (-not (Test-Path -LiteralPath $ThumbsDir)) { return }
    Get-ChildItem -LiteralPath $ThumbsDir -File | ForEach-Object {
        if ($_.Name -eq $script:ThumbCacheFileName) { return }
        if (-not $KeepDestNames.Contains($_.Name)) {
            Remove-Item -LiteralPath $_.FullName -Force
        }
    }
}
