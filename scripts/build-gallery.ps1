# Scans media/gallery (including subfolders) for images, writes JPEG thumbnails
# (Windows / System.Drawing), and writes media/gallery/images.json.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-gallery.ps1
# Or: scripts\build-gallery.cmd
#
# Full console output is copied to: scripts/build-gallery.log

$LogFile = Join-Path $PSScriptRoot "build-gallery.log"
try { Stop-Transcript | Out-Null } catch {}

try {
    Start-Transcript -LiteralPath $LogFile -Force | Out-Null
}
catch {
    Write-Warning "Could not start transcript (log may be incomplete): $_"
    $LogFile = $null
}

$exitCode = 0
try {
    . (Join-Path $PSScriptRoot "thumbnail-utils.ps1")
    $ErrorActionPreference = "Stop"
    $root = Split-Path -Parent $PSScriptRoot
    $galleryDir = Join-Path $root "media\gallery"
    $thumbsDir = Join-Path $galleryDir "thumbs"
    $outFile = Join-Path $galleryDir "images.json"
    $extensions = @(".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".svg")
    $thumbMaxWidth = 420
    $skipDirNames = @("thumbs", ".git")

    if (-not (Test-Path -LiteralPath $galleryDir)) {
        New-Item -ItemType Directory -Path $galleryDir -Force | Out-Null
    }

    function Get-HumanAlt([string] $fileName) {
        $base = [System.IO.Path]::GetFileNameWithoutExtension($fileName)
        if ([string]::IsNullOrWhiteSpace($base)) { return $fileName }
        return (($base -creplace "[-_]+", " ") -replace "\s+", " ").Trim()
    }

    function Get-HumanFolderTitle([string] $folderPath) {
        if ([string]::IsNullOrWhiteSpace($folderPath)) { return "" }
        $parts = $folderPath -split "/"
        return (($parts | ForEach-Object { Get-HumanAlt $_ }) -join " / ")
    }

    function Get-GalleryAbsPath([string] $RelPath) {
        $sub = $RelPath -replace "/", [System.IO.Path]::DirectorySeparatorChar
        return Join-Path $galleryDir $sub
    }

    function Get-ProjectSourceMap([string] $siteRoot) {
        $configPath = Join-Path $siteRoot "media\gallery\project-sources.json"
        if (-not (Test-Path -LiteralPath $configPath)) { return @{} }
        try {
            $data = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if (-not $data.groups) { return @{} }
            return $data.groups
        }
        catch {
            Write-Warning "Gallery: invalid project-sources.json: $_"
            return @{}
        }
    }

    function Get-ProjectGalleryEntries([string] $siteRoot, [string] $slug) {
        $dir = Join-Path $siteRoot "projects\$slug"
        $manifestPath = Join-Path $dir "images.json"
        if (-not (Test-Path -LiteralPath $manifestPath)) {
            Write-Warning "Gallery: no images.json for project $slug"
            return @()
        }
        try {
            $data = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        }
        catch {
            Write-Warning "Gallery: skip invalid images.json in ${slug}: $_"
            return @()
        }
        $images = @($data.images)
        if (-not $images -or $images.Count -eq 0) { return @() }

        $label = Get-HumanAlt $slug
        $seen = @{}
        $out = New-Object System.Collections.Generic.List[object]

        foreach ($entry in $images) {
            $file = if ($entry -is [string]) { $entry } else { [string]$entry.file }
            if ([string]::IsNullOrWhiteSpace($file)) { continue }
            $key = $file.ToLowerInvariant()
            if ($seen.ContainsKey($key)) { continue }
            $seen[$key] = $true

            $alt = if ($entry.alt) { [string]$entry.alt } else { Get-HumanAlt $file }
            $o = [ordered]@{
                file = "projects/$slug/$file"
                alt  = "$label - $alt"
            }
            if ($entry.thumb) {
                $o.thumb = "projects/$slug/$($entry.thumb)"
            }
            [void]$out.Add([PSCustomObject]$o)
        }

        Write-Host "Gallery: $($out.Count) image(s) from project $slug"
        return $out.ToArray()
    }

    function Merge-ProjectSourcesIntoGroups([object[]] $groups, [string] $siteRoot) {
        $sources = Get-ProjectSourceMap $siteRoot
        if ($null -eq $sources) { return $groups }

        $folderNames = @(
            if ($sources -is [System.Collections.IDictionary]) {
                $sources.Keys
            }
            else {
                $sources.PSObject.Properties | ForEach-Object { $_.Name }
            }
        )
        if (-not $folderNames -or $folderNames.Count -eq 0) { return $groups }

        Write-Host "Gallery: merging project images ($($folderNames.Count) group mapping(s))"

        $byFolder = @{}
        $groupList = New-Object System.Collections.ArrayList
        foreach ($g in $groups) {
            [void]$groupList.Add([object]$g)
            $byFolder[$g.folder] = $g
        }

        foreach ($folder in $folderNames) {
            $slugs = @(
                if ($sources -is [System.Collections.IDictionary]) {
                    $sources[$folder]
                }
                else {
                    $sources.$folder
                }
            )
            if (-not $slugs -or $slugs.Count -eq 0) { continue }

            $group = $byFolder[$folder]
            if (-not $group) {
                $group = [PSCustomObject]@{
                    folder = [string]$folder
                    title  = [string](Get-HumanFolderTitle $folder)
                    images = @()
                }
                $byFolder[$folder] = $group
                [void]$groupList.Add([object]$group)
            }

            $merged = New-Object System.Collections.Generic.List[object]
            foreach ($img in @($group.images)) { [void]$merged.Add($img) }
            foreach ($slug in $slugs) {
                foreach ($img in (Get-ProjectGalleryEntries $siteRoot ([string]$slug))) {
                    [void]$merged.Add($img)
                }
            }
            $group | Add-Member -NotePropertyName images -NotePropertyValue $merged.ToArray() -Force
        }

        return @($groupList | Sort-Object { $_.folder })
    }

    function Write-JpegThumbnail {
        param(
            [string] $SourcePath,
            [string] $DestPath,
            [int] $MaxWidth
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

    function Get-RelImageFiles {
        param(
            [string] $Dir,
            [string] $RelPrefix = ""
        )
        $found = New-Object System.Collections.Generic.List[string]
        if (-not (Test-Path -LiteralPath $Dir)) { return @() }

        Get-ChildItem -LiteralPath $Dir | Sort-Object Name | ForEach-Object {
            if ($_.Name -eq "images.json" -or $_.Name -eq ".gitkeep" -or $_.Name -eq "project-sources.json") { return }

            $rel = if ($RelPrefix) { "$RelPrefix/$($_.Name)" } else { $_.Name }
            $rel = $rel -replace "\\", "/"

            if ($_.PSIsContainer) {
                if ($skipDirNames -contains $_.Name) { return }
                $found.AddRange([string[]](Get-RelImageFiles -Dir $_.FullName -RelPrefix $rel))
                return
            }

            if ($extensions -contains $_.Extension.ToLowerInvariant()) {
                [void]$found.Add($rel)
            }
        }

        return $found.ToArray()
    }

    $relFiles = Get-RelImageFiles -Dir $galleryDir
    Write-Host "Found $($relFiles.Count) source image(s) under media/gallery"

    New-Item -ItemType Directory -Path $thumbsDir -Force | Out-Null

    Add-Type -AssemblyName System.Drawing

    $thumbMap = @{}
    $thumbCreated = 0
    $thumbSkipped = 0
    $cache = Get-ThumbCacheHashtable $thumbsDir
    $keepDestNames = [System.Collections.Generic.HashSet[string]]::new()

    foreach ($rel in $relFiles) {
        $ext = [System.IO.Path]::GetExtension($rel).ToLowerInvariant()
        if ($ext -eq ".svg") { continue }

        $cacheKey = $rel -replace "\\", "/"
        $srcPath = Get-GalleryAbsPath $rel
        $destName = Get-ThumbFileName $cacheKey
        $destPath = Join-Path $thumbsDir $destName
        [void]$keepDestNames.Add($destName)

        if (Test-ThumbIsFresh -SrcPath $srcPath -DestPath $destPath -CacheKey $cacheKey -Cache $cache) {
            $thumbMap[$rel] = "thumbs/$destName"
            $thumbSkipped++
            continue
        }

        if (Write-JpegThumbnail -SourcePath $srcPath -DestPath $destPath -MaxWidth $thumbMaxWidth) {
            $cache[$cacheKey] = Get-SourceFileSha256 $srcPath
            $thumbMap[$rel] = "thumbs/$destName"
            $thumbCreated++
        }
    }

    $activeKeys = @($relFiles | ForEach-Object { $_ -replace "\\", "/" })
    Update-ThumbCacheKeys -Cache $cache -ActiveKeys $activeKeys
    Remove-OrphanThumbFiles -ThumbsDir $thumbsDir -KeepDestNames $keepDestNames
    Set-ThumbCacheHashtable -ThumbsDir $thumbsDir -Entries $cache

    $imagesByFolder = @{}
    foreach ($rel in $relFiles) {
        $slash = $rel.LastIndexOf("/")
        if ($slash -ge 0) {
            $dir = $rel.Substring(0, $slash)
        }
        else {
            $dir = ""
        }

        if (-not $imagesByFolder.ContainsKey($dir)) {
            $imagesByFolder[$dir] = New-Object System.Collections.Generic.List[object]
        }

        $fileName = [System.IO.Path]::GetFileName($rel)
        $o = [ordered]@{
            file = $rel
            alt  = (Get-HumanAlt $fileName)
        }
        if ($thumbMap.ContainsKey($rel)) {
            $o.thumb = $thumbMap[$rel]
        }
        [void]$imagesByFolder[$dir].Add([PSCustomObject]$o)
    }

    $folderKeys = @($imagesByFolder.Keys | Sort-Object {
        if ($_ -eq "") { return "`0" }
        $_
    })

    $groupObjs = foreach ($folder in $folderKeys) {
        $imageList = $imagesByFolder[$folder]
        $imageArr = if ($null -eq $imageList) { @() } else { @($imageList.ToArray()) }
        [PSCustomObject]@{
            folder = [string]$folder
            title  = [string](Get-HumanFolderTitle $folder)
            images = $imageArr
        }
    }

    $groupObjs = Merge-ProjectSourcesIntoGroups @($groupObjs) $root

    $version = [int64]([DateTime]::UtcNow - [datetime]'1970-01-01T00:00:00Z').TotalMilliseconds

    $payload = [ordered]@{
        version = $version
        groups  = @($groupObjs)
    }

    $json = ($payload | ConvertTo-Json -Depth 8)
    if (-not $json.EndsWith("`n")) { $json += "`n" }

    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($outFile, $json, $utf8NoBom)

    $projectImageCount = 0
    foreach ($g in $groupObjs) {
        $projectImageCount += @($g.images | Where-Object { $_.file -like "projects/*" }).Count
    }
    Write-Host "Gallery: wrote $($relFiles.Count) media + $projectImageCount project image(s) in $($groupObjs.Count) group(s) -> media/gallery/images.json ($thumbCreated thumbnails built, $thumbSkipped unchanged)"
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
