# Scans projects/<slug>/ for index.html + images, writes manifest + images.json.
# Tiles: cover.* then hero.* then first image. Page top: hero.* then cover.* then first image.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-projects.ps1
# Or: scripts\build-projects.cmd
#
# Full console output: scripts/build-projects.log
# Run with analysis: scripts\build-projects-log.cmd

$LogFile = Join-Path $PSScriptRoot "build-projects.log"
try { Stop-Transcript | Out-Null } catch {}
try {
    Start-Transcript -LiteralPath $LogFile -Force | Out-Null
}
catch {
    Write-Warning "Could not start transcript (log may be incomplete): $_"
    $LogFile = $null
}

$exitCode = 0
$script:BuildProjectErrors = New-Object System.Collections.Generic.List[string]

$root = Split-Path -Parent $PSScriptRoot
$projectsDir = Join-Path $root "projects"
$manifestFile = Join-Path $projectsDir "manifest.json"
$orderFile = Join-Path $projectsDir "featured-order.txt"
$coverPriority = @("cover.jpg", "cover.jpeg", "cover.png", "cover.webp")
$heroPriority = @("hero.jpg", "hero.jpeg", "hero.png", "hero.webp")
$imageExt = @(".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif")
$skipFiles = @("images.json", "project.json", "index.html")

function Get-HumanSlug([string] $slug) {
    return (($slug -creplace "[-_]+", " ") -replace "\s+", " ").Trim()
}

function Get-HumanAlt([string] $fileName) {
    $base = [System.IO.Path]::GetFileNameWithoutExtension($fileName)
    if ([string]::IsNullOrWhiteSpace($base)) { return $fileName }
    return (($base -creplace "[-_]+", " ") -replace "\s+", " ").Trim()
}

function Test-IsImageFile([string] $name) {
    return $imageExt -contains [System.IO.Path]::GetExtension($name).ToLowerInvariant()
}

function Test-IsCoverFile([string] $name) {
    return $name -match '^cover\.'
}

function Test-IsHeroFile([string] $name) {
    return $name -match '^hero\.'
}

function Get-PriorityFileName([string[]] $files, [string[]] $priority) {
    foreach ($name in $priority) {
        $hit = $files | Where-Object { $_ -ieq $name } | Select-Object -First 1
        if ($hit) { return $hit }
    }
    return $null
}

function Get-FirstSortedImage([string[]] $files) {
    if (-not $files -or $files.Count -eq 0) { return $null }
    return ($files | Sort-Object | Select-Object -First 1)
}

function Get-ImageFiles([string] $dir) {
    Get-ChildItem -LiteralPath $dir -File |
        Where-Object { $skipFiles -notcontains $_.Name -and (Test-IsImageFile $_.Name) } |
        Select-Object -ExpandProperty Name
}

function Get-CoverFileName([string] $dir) {
    $files = @(Get-ImageFiles $dir)
    $hit = Get-PriorityFileName $files $coverPriority
    if ($hit) { return $hit }
    $hit = $files | Where-Object { Test-IsCoverFile $_ } | Select-Object -First 1
    if ($hit) { return $hit }
    $hit = Get-PriorityFileName $files $heroPriority
    if ($hit) { return $hit }
    $hit = $files | Where-Object { Test-IsHeroFile $_ } | Select-Object -First 1
    if ($hit) { return $hit }
    return Get-FirstSortedImage $files
}

function Get-HeroFileName([string] $dir, [string] $coverFile) {
    $files = @(Get-ImageFiles $dir)
    $hit = Get-PriorityFileName $files $heroPriority
    if ($hit) { return $hit }
    $hit = $files | Where-Object { Test-IsHeroFile $_ } | Select-Object -First 1
    if ($hit) { return $hit }
    if ($coverFile) { return $coverFile }
    $hit = Get-PriorityFileName $files $coverPriority
    if ($hit) { return $hit }
    $hit = $files | Where-Object { Test-IsCoverFile $_ } | Select-Object -First 1
    if ($hit) { return $hit }
    return Get-FirstSortedImage $files
}

function Get-GalleryFileNames([string] $dir, [string] $coverFile, [string] $heroFile, [string[]] $exclude) {
    $excludeLower = @{}
    foreach ($e in $exclude) { $excludeLower[$e.ToLowerInvariant()] = $true }
    $coverLower = if ($coverFile) { $coverFile.ToLowerInvariant() } else { $null }
    $heroLower = if ($heroFile) { $heroFile.ToLowerInvariant() } else { $null }

    $names = New-Object System.Collections.Generic.List[string]
    foreach ($name in (Get-ImageFiles $dir | Sort-Object)) {
        $lower = $name.ToLowerInvariant()
        if ($coverLower -and $lower -eq $coverLower) { continue }
        if ($heroLower -and $lower -eq $heroLower) { continue }
        if (Test-IsCoverFile $name) { continue }
        if (Test-IsHeroFile $name) { continue }
        if ($excludeLower.ContainsKey($lower)) { continue }
        [void]$names.Add($name)
    }
    $rest = $names.ToArray()
    if ($coverFile -and -not $excludeLower.ContainsKey($coverLower)) {
        return @([string]$coverFile) + @($rest)
    }
    return $rest
}

function Get-ThumbFileName([string] $fileName) {
    $md5 = [System.Security.Cryptography.MD5]::Create()
    $hash = $md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($fileName))
    $sb = New-Object System.Text.StringBuilder
    for ($i = 0; $i -lt 7 -and $i -lt $hash.Length; $i++) {
        [void]$sb.AppendFormat("{0:x2}", $hash[$i])
    }
    return $sb.ToString() + ".jpg"
}

function Write-JpegThumbnail {
    param(
        [string] $SourcePath,
        [string] $DestPath,
        [int] $MaxWidth = 420
    )
    $img = $null
    $bmp = $null
    $g = $null
    try {
        $img = [System.Drawing.Image]::FromFile($SourcePath)
        $w = $img.Width
        $h = $img.Height
        if ($w -le 0 -or $h -le 0) { return $false }

        $ratio = [double]$MaxWidth / [double]$w
        if ($ratio -gt 1.0) { $ratio = 1.0 }

        $newW = [int][Math]::Max(1, [Math]::Round($w * $ratio))
        $newH = [int][Math]::Max(1, [Math]::Round($h * $ratio))

        $bmp = New-Object System.Drawing.Bitmap $newW, $newH
        $bmp.SetResolution($img.HorizontalResolution, $img.VerticalResolution)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $rect = New-Object System.Drawing.Rectangle 0, 0, $newW, $newH
        $g.DrawImage($img, $rect)

        $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
            Where-Object { $_.MimeType -eq "image/jpeg" }
        if (-not $codec) { return $false }

        $ep = New-Object System.Drawing.Imaging.EncoderParameters 1
        $quality = [long]82
        $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter (
            [System.Drawing.Imaging.Encoder]::Quality,
            $quality
        )
        [void]$bmp.Save($DestPath, $codec, $ep)
        return $true
    }
    catch {
        Write-Warning "Thumbnail failed for $SourcePath : $_"
        return $false
    }
    finally {
        if ($null -ne $g) { $g.Dispose() }
        if ($null -ne $bmp) { $bmp.Dispose() }
        if ($null -ne $img) { $img.Dispose() }
    }
}

function Build-ProjectThumbs([string] $dir, [string[]] $galleryFiles) {
    $thumbMap = @{}
    if (-not $galleryFiles -or $galleryFiles.Count -eq 0) { return $thumbMap }

    $thumbsDir = Join-Path $dir "thumbs"
    if (Test-Path -LiteralPath $thumbsDir) {
        Remove-Item -LiteralPath $thumbsDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $thumbsDir -Force | Out-Null

    foreach ($file in $galleryFiles) {
        if ($file -match '\.svg$') { continue }
        $ext = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
        if ($ext -notin @('.jpg', '.jpeg', '.png')) {
            Write-Warning "Projects: skip thumb for $file ($ext not supported by Windows thumbnailer; use JPG/PNG or run npm run build:projects with sharp)"
            continue
        }
        $srcPath = Join-Path $dir $file
        $destName = Get-ThumbFileName $file
        $destPath = Join-Path $thumbsDir $destName
        if (Write-JpegThumbnail -SourcePath $srcPath -DestPath $destPath) {
            $thumbMap[$file] = "thumbs/$destName"
        }
    }
    return $thumbMap
}

function Get-GalleryImages([string] $dir, [string] $coverFile, [string] $heroFile, [string[]] $exclude, [hashtable] $thumbMap) {
    $list = New-Object System.Collections.Generic.List[object]
    foreach ($name in (Get-GalleryFileNames $dir $coverFile $heroFile $exclude)) {
        $o = [ordered]@{
            file = $name
            alt  = (Get-HumanAlt $name)
        }
        if ($thumbMap.ContainsKey($name)) {
            $o.thumb = $thumbMap[$name]
        }
        [void]$list.Add([PSCustomObject]$o)
    }
    return $list.ToArray()
}

function Get-TitleFromHtml([string] $htmlPath) {
    if (-not (Test-Path -LiteralPath $htmlPath)) { return "" }
    $html = [System.IO.File]::ReadAllText($htmlPath)
    if ($html -match '<h1[^>]*>([\s\S]*?)</h1>') {
        $t = $Matches[1] -replace '<[^>]+>', ''
        $t = [System.Net.WebUtility]::HtmlDecode($t)
        return ($t -replace '\s+', ' ').Trim()
    }
    return ""
}

function Get-YoutubeId([string] $value) {
    if ([string]::IsNullOrWhiteSpace($value)) { return $null }
    $s = $value.Trim()
    if ($s -match '^[\w-]{11}$') { return $s }
    try {
        if ($s -notmatch '^https?://') { $s = "https://$s" }
        $u = [Uri]$s
        if ($u.Host -eq 'youtu.be' -or $u.Host.EndsWith('.youtu.be')) {
            return ($u.AbsolutePath.TrimStart('/') -split '/')[0]
        }
        if ($u.Host -match 'youtube\.com') {
            if ($u.Query -match '(?:^|&)v=([^&]+)') {
                return $Matches[1]
            }
        }
    }
    catch { }
    return $null
}

function Get-YoutubeIdFromMeta($meta) {
    if (-not $meta) { return $null }
    foreach ($key in @('coverYoutube', 'heroYoutube', 'youtube')) {
        if ($meta.PSObject.Properties.Name -contains $key) {
            $id = Get-YoutubeId ([string]$meta.$key)
            if ($id) { return $id }
        }
    }
    return $null
}

function Save-YoutubeCover([string] $dir, $meta, [string] $slug) {
    $id = Get-YoutubeIdFromMeta $meta
    if (-not $id) { return }

    $dest = Join-Path $dir 'cover.jpg'
    foreach ($quality in @('maxresdefault', 'hqdefault')) {
        $url = "https://img.youtube.com/vi/$id/$quality.jpg"
        try {
            $resp = Invoke-WebRequest -Uri $url -UseBasicParsing
            if ($resp.StatusCode -ge 400) { continue }
            if ($resp.RawContentLength -lt 8000) { continue }
            [System.IO.File]::WriteAllBytes($dest, $resp.Content)
            Write-Host "Projects: $slug cover.jpg from YouTube $quality ($id)"
            return
        }
        catch {
            Write-Warning "Projects: $slug YouTube cover ($quality): $_"
        }
    }
    Write-Warning "Projects: $slug could not download YouTube cover for $id"
}

function Get-ImagesJsonFragment($images) {
    $list = @($images)
    if ($list.Count -eq 0) { return '[]' }
    if ($list.Count -eq 1) {
        return '[' + ($list[0] | ConvertTo-Json -Compress -Depth 5) + ']'
    }
    return ($list | ConvertTo-Json -Depth 5)
}

function Get-FeaturedOrder {
    if (-not (Test-Path -LiteralPath $orderFile)) { return @() }
    return [System.IO.File]::ReadAllText($orderFile) -split "`r?`n" |
        ForEach-Object { ($_ -replace '#.*$', '').Trim() } |
        Where-Object { $_ }
}

try {
    $ErrorActionPreference = "Stop"

    if (-not (Test-Path -LiteralPath $projectsDir)) {
        New-Item -ItemType Directory -Path $projectsDir -Force | Out-Null
    }

    $featuredOrder = @(Get-FeaturedOrder)
$orderRank = @{}
for ($i = 0; $i -lt $featuredOrder.Count; $i++) {
    $orderRank[$featuredOrder[$i]] = $i
}

$version = [int64]([DateTime]::UtcNow - [datetime]'1970-01-01T00:00:00Z').TotalMilliseconds
$entries = New-Object System.Collections.Generic.List[object]
$thumbTotal = 0

Add-Type -AssemblyName System.Drawing

    Get-ChildItem -LiteralPath $projectsDir -Directory |
        Where-Object { -not $_.Name.StartsWith('.') } |
        ForEach-Object {
            $slug = $_.Name
            $dir = $_.FullName
            $indexPath = Join-Path $dir "index.html"
            if (-not (Test-Path -LiteralPath $indexPath)) { return }

            try {

        $meta = $null
        $metaPath = Join-Path $dir "project.json"
        if (Test-Path -LiteralPath $metaPath) {
            try {
                $meta = Get-Content -LiteralPath $metaPath -Raw | ConvertFrom-Json
            }
            catch {
                Write-Warning "Invalid project.json in ${slug}: $_"
            }
        }

        $exclude = @()
        if ($meta -and $meta.excludeFromGallery) {
            $exclude = @($meta.excludeFromGallery | ForEach-Object { [string]$_ })
        }

        Save-YoutubeCover $dir $meta $slug
        $coverFile = Get-CoverFileName $dir
        $heroFile = Get-HeroFileName $dir $coverFile
        $galleryFiles = Get-GalleryFileNames $dir $coverFile $heroFile $exclude
        $thumbMap = Build-ProjectThumbs $dir $galleryFiles
        $thumbTotal += $thumbMap.Count
        $galleryImages = Get-GalleryImages $dir $coverFile $heroFile $exclude $thumbMap

        $coverJson = if ($coverFile) { ($coverFile | ConvertTo-Json) } else { 'null' }
        $heroJson = if ($heroFile) { ($heroFile | ConvertTo-Json) } else { 'null' }
        $imagesFragment = Get-ImagesJsonFragment $galleryImages
        $folderJson = @"
{
  "version": $version,
  "cover": $coverJson,
  "hero": $heroJson,
  "images": $imagesFragment
}
"@
        $utf8 = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText((Join-Path $dir "images.json"), $folderJson, $utf8)

        $title = ""
        if ($meta -and $meta.title) { $title = [string]$meta.title.Trim() }
        if (-not $title) { $title = Get-TitleFromHtml $indexPath }
        if (-not $title) { $title = Get-HumanSlug $slug }

        $featured = $false
        if ($meta -and $meta.featured -eq $false) { $featured = $false }
        elseif ($meta -and $meta.featured -eq $true) { $featured = $true }
        elseif ($orderRank.ContainsKey($slug)) { $featured = $true }

        $order = 9999
        if ($meta -and $null -ne $meta.order) { $order = [int]$meta.order }
        elseif ($orderRank.ContainsKey($slug)) { $order = $orderRank[$slug] }

        $coverPath = $null
        if ($coverFile) { $coverPath = "projects/$slug/$coverFile" }

        [void]$entries.Add([PSCustomObject]@{
            slug     = $slug
            title    = $title
            href     = "projects/$slug/"
            cover    = $coverPath
            featured = $featured
            order    = $order
        })

            }
            catch {
                $msg = "${slug}: $($_.Exception.Message)"
                [void]$script:BuildProjectErrors.Add($msg)
                Write-Warning "Projects: FAILED $msg"
            }
        }

    $all = @($entries | Sort-Object @{ Expression = { -not $_.featured } }, @{ Expression = 'order' }, @{ Expression = 'title' })
    $featuredList = @($all | Where-Object { $_.featured })

    $payload = [ordered]@{
        version  = $version
        featured = $featuredList
        projects = $all
    }

    $json = ($payload | ConvertTo-Json -Depth 6)
    if (-not $json.EndsWith("`n")) { $json += "`n" }
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($manifestFile, $json, $utf8)

    Write-Host "Projects: $($all.Count) project(s), $($featuredList.Count) featured, $thumbTotal thumbnail(s) -> projects/manifest.json"

    if ($script:BuildProjectErrors.Count -gt 0) {
        Write-Host ""
        Write-Host "Project errors ($($script:BuildProjectErrors.Count)):" -ForegroundColor Yellow
        foreach ($e in $script:BuildProjectErrors) {
            Write-Host "  - $e" -ForegroundColor Yellow
        }
        $exitCode = 1
    }
}
catch {
    $exitCode = 1
    Write-Host ""
    Write-Host "FATAL: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.InvocationInfo.PositionMessage) {
        Write-Host $_.InvocationInfo.PositionMessage -ForegroundColor DarkRed
    }
    if ($_.ScriptStackTrace) {
        Write-Host $_.ScriptStackTrace -ForegroundColor DarkRed
    }
}
finally {
    if ($LogFile) {
        try { Stop-Transcript | Out-Null } catch {}
        Write-Host ""
        Write-Host "Log saved to: $LogFile" -ForegroundColor Cyan
    }
}

exit $exitCode
