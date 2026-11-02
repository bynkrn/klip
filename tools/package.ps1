param([string]$OutDirectory='dist')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
  $outputRoot=[IO.Path]::GetFullPath((Join-Path $projectRoot $OutDirectory))
  $allowedRoot=[IO.Path]::GetFullPath((Join-Path $projectRoot 'dist'))
  if($outputRoot -ne $allowedRoot -and -not $outputRoot.StartsWith($allowedRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Package output must remain within project dist'}
  $packagedRoot=Join-Path $outputRoot 'Ember-win32-x64'
  & (Join-Path $PSScriptRoot 'native-capture/build.ps1')
  & (Join-Path $PSScriptRoot 'build-updater.ps1')
  & "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe /reference:System.Web.Extensions.dll /out:tools\window-watcher.exe tools\windows.cs
  if ($LASTEXITCODE -ne 0) { throw 'Window watcher build failed' }
  & "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe /reference:System.Web.Extensions.dll /reference:Microsoft.CSharp.dll /out:tools\recycle-bin.exe tools\recycle-bin.cs
  if ($LASTEXITCODE -ne 0) { throw 'Recycle Bin helper build failed' }
  node tools/build-ui.js
  if ($LASTEXITCODE -ne 0) { throw 'UI build failed' }
  $ignore=@(
    '^/(tests|test-buffer|dist|node_modules|\.git|\.github|docs)(?:/|$)',
    '^/engine/obs/config(?:/|$)',
    '^/engine/(?!obs(?:/|$))',
    '^/src/ui-template\.html$',
    '^/tools/(build-deps|native-capture/build|native-capture/smoke-buffer)(?:/|$)',
    '^/tools/(build-ui\.js|package\.ps1|bootstrap-runtime\.ps1|sign-release\.js|build-installer\.ps1)$',
    '^/tools/installer(?:/|$)',
    '^/tools/native-capture/KlipHeadlessSmoke\.exe$',
    '^/engine/obs/bin/64bit/(obs64\.exe|obs-frontend-api\.dll|Qt6[^/]*\.dll)$',
    '^/engine/obs/obs-plugins/64bit/(?!(win-capture|win-wasapi|obs-nvenc|obs-ffmpeg)\.dll$)',
    '^/engine/obs/data/obs-plugins/(?!(win-capture|win-wasapi|obs-nvenc|obs-ffmpeg)(?:/|$))'
  ) -join '|'
  $packager=Join-Path $projectRoot 'tools/build-deps/npm-lock/node_modules/@electron/packager/bin/electron-packager.mjs'
  if(-not (Test-Path -LiteralPath $packager)){$packager=Join-Path $projectRoot 'node_modules/@electron/packager/bin/electron-packager.mjs'}
  node $packager . Ember --platform=win32 --arch=x64 --electron-version=44.10.1 "--out=$outputRoot" --icon=src/icon.ico --no-asar --overwrite --prune=false "--ignore=$ignore"
  if ($LASTEXITCODE -ne 0) { throw 'Packaging failed' }
  if (-not (Test-Path -LiteralPath (Join-Path $packagedRoot 'resources/app/engine/obs/bin/64bit/Ember.Capture.exe'))) { throw 'Packaged capture service missing' }
  if (Test-Path -LiteralPath (Join-Path $packagedRoot 'resources/app/engine/obs/bin/64bit/obs64.exe')) { throw 'OBS GUI must not be included' }
  $captureRoot=Join-Path $packagedRoot 'resources/app/engine/obs'
  foreach($module in @('win-capture','win-wasapi','obs-nvenc','obs-ffmpeg')) {
    if(-not(Test-Path -LiteralPath (Join-Path $captureRoot "core/$module/$module.dll"))){throw "Packaged capture module missing: $module"}
  }
  foreach($companion in @('graphics-hook32.dll','graphics-hook64.dll','inject-helper32.exe','inject-helper64.exe','get-graphics-offsets32.exe','get-graphics-offsets64.exe')) {
    if(-not(Test-Path -LiteralPath (Join-Path $captureRoot "core/win-capture/data/$companion"))){throw "Packaged game hook companion missing: $companion"}
  }
  foreach($runtime in @('MSVCP140.dll','VCRUNTIME140.dll','VCRUNTIME140_1.dll')) {
    if(-not(Test-Path -LiteralPath (Join-Path $captureRoot "bin/64bit/$runtime"))){throw "Packaged app-local runtime missing: $runtime"}
  }
  foreach($helper in @('update-install.exe','github/gh.exe','window-watcher.exe','recycle-bin.exe')){if(-not(Test-Path -LiteralPath (Join-Path $packagedRoot "resources/app/tools/$helper"))){throw "Packaged helper missing: $helper"}}
} finally { Pop-Location }
