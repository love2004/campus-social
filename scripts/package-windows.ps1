param([string]$OutputPath)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$node = (Get-Command node.exe).Source
$version = & $node -p 'process.versions.node'
$architecture = & $node -p 'process.arch'
if ($architecture -ne 'x64' -or [version]$version -lt [version]'24.14.0') {
    throw 'Packaging requires Windows x64 Node.js 24.14 or newer.'
}
if (-not (Test-Path -LiteralPath $compiler)) {
    throw 'The Windows .NET Framework C# compiler was not found.'
}

$buildDirectory = Join-Path ([IO.Path]::GetTempPath()) ('campus-social-' + [guid]::NewGuid().ToString('N'))
$payload = Join-Path $buildDirectory 'payload'
$archive = Join-Path $buildDirectory 'runtime.zip'
$launcher = Join-Path $buildDirectory 'Launcher.cs'
$workspace = Join-Path $buildDirectory 'WorkspaceView.cs'
$settings = Join-Path $buildDirectory 'SettingsDialogs.cs'
$name = 'CampusSocial.exe'
$program = Join-Path $buildDirectory $name
$destination = if ($OutputPath) { [IO.Path]::GetFullPath($OutputPath) } else { Join-Path $root $name }
Push-Location $root
try {
    & npm.cmd run selfhost:build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }

    $backend = Join-Path $payload 'selfhost'
    $windows = Join-Path $backend 'windows'
    New-Item -ItemType Directory -Path $windows | Out-Null
    Copy-Item -LiteralPath $node -Destination (Join-Path $payload 'node.exe')
    Get-ChildItem -LiteralPath (Join-Path $root 'selfhost') -File -Filter '*.mjs' | Copy-Item -Destination $backend
    Copy-Item -LiteralPath 'selfhost/windows/run.mjs' -Destination $windows
    Copy-Item -LiteralPath 'selfhost-dist' -Destination $payload -Recurse
    & $node 'selfhost/windows/stage.mjs' $payload
    if ($LASTEXITCODE -ne 0) { throw 'Copying runtime dependencies failed.' }

    Push-Location $payload
    try {
        & (Join-Path $payload 'node.exe') --input-type=module -e "await import('./selfhost/server.mjs')"
        if ($LASTEXITCODE -ne 0) { throw 'The packaged runtime could not load the backend.' }
    }
    finally { Pop-Location }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $webViewVersion = '1.0.4258.31'
    $webViewArchive = Join-Path $buildDirectory 'webview2.nupkg'
    $webViewSdk = Join-Path $buildDirectory 'webview2-sdk'
    $webViewRuntime = Join-Path $payload 'webview2'
    $packageUrl = "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$webViewVersion/microsoft.web.webview2.$webViewVersion.nupkg"
    Invoke-WebRequest -UseBasicParsing -Uri $packageUrl -OutFile $webViewArchive -TimeoutSec 60
    if ((Get-FileHash -LiteralPath $webViewArchive -Algorithm SHA256).Hash -ne '56F7F4B8BF9AEE4B8EFEFBBDD4F67D5F74EBD1B100ED0806DA71BF76AF481AA9') {
        throw 'The WebView2 SDK package checksum does not match.'
    }
    [IO.Compression.ZipFile]::ExtractToDirectory($webViewArchive, $webViewSdk)
    New-Item -ItemType Directory -Path $webViewRuntime | Out-Null
    foreach ($file in @(
        'lib/net462/Microsoft.Web.WebView2.Core.dll',
        'lib/net462/Microsoft.Web.WebView2.WinForms.dll',
        'runtimes/win-x64/native/WebView2Loader.dll',
        'LICENSE.txt',
        'NOTICE.txt'
    )) {
        Copy-Item -LiteralPath (Join-Path $webViewSdk $file) -Destination $webViewRuntime
    }

    [IO.Compression.ZipFile]::CreateFromDirectory($payload, $archive, [IO.Compression.CompressionLevel]::Optimal, $false)
    Copy-Item -LiteralPath 'selfhost/windows/Launcher.cs' -Destination $launcher
    Copy-Item -LiteralPath 'selfhost/windows/WorkspaceView.cs' -Destination $workspace
    Copy-Item -LiteralPath 'selfhost/windows/SettingsDialogs.cs' -Destination $settings
    $core = Join-Path $webViewRuntime 'Microsoft.Web.WebView2.Core.dll'
    $winForms = Join-Path $webViewRuntime 'Microsoft.Web.WebView2.WinForms.dll'
    & $compiler /nologo /target:winexe /platform:x64 /codepage:65001 /optimize+ "/out:$program" "/resource:$archive,runtime.zip" '/reference:System.IO.Compression.dll' '/reference:System.IO.Compression.FileSystem.dll' '/reference:System.Web.Extensions.dll' "/reference:$core" "/reference:$winForms" $launcher $workspace $settings
    if ($LASTEXITCODE -ne 0) { throw 'Compiling the Windows launcher failed.' }

    Copy-Item -LiteralPath $program -Destination $destination -Force
    Write-Host "Created $destination"
}
finally {
    Pop-Location
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $verified = [IO.Path]::GetFullPath($buildDirectory)
    if ($verified.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $verified)) {
        Remove-Item -LiteralPath $verified -Recurse -Force
    }
}
