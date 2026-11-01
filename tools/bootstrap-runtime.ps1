param([string]$FfmpegBin=$env:FFMPEG_BIN)
$ErrorActionPreference='Stop'
$projectDir=Split-Path -Parent $PSScriptRoot
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'runtime-dependencies.json') -Raw | ConvertFrom-Json
$cacheDir=Join-Path $PSScriptRoot 'build-deps'
New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
function Get-VerifiedArchive($name,$definition) {
 $archive=Join-Path $cacheDir ($name+'.zip')
 if(-not (Test-Path -LiteralPath $archive)){Invoke-WebRequest -Uri $definition.url -OutFile $archive}
 if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $definition.sha256){throw "$name dependency hash mismatch"}
 return $archive
}
$engineDir=Join-Path $projectDir 'engine/obs'
if(-not (Test-Path -LiteralPath (Join-Path $engineDir 'bin/64bit/obs.dll')) -or -not (Test-Path -LiteralPath (Join-Path $engineDir 'obs-plugins/64bit/win-capture.dll'))){
 $archive=Get-VerifiedArchive 'obs-33.0.1' $manifest.obs
 $extraction=Join-Path $cacheDir 'obs-extracted'
 Expand-Archive -LiteralPath $archive -DestinationPath $extraction -Force
 $payload=$extraction
 if(-not (Test-Path -LiteralPath (Join-Path $payload 'bin/64bit/obs.dll'))){$payload=@(Get-ChildItem -LiteralPath $extraction -Directory | Where-Object {Test-Path -LiteralPath (Join-Path $_.FullName 'bin/64bit/obs.dll')})[0].FullName}
 if(-not $payload){throw 'OBS dependency layout was not recognized'}
 New-Item -ItemType Directory -Path $engineDir -Force | Out-Null
 Get-ChildItem -LiteralPath $payload | Copy-Item -Destination $engineDir -Recurse -Force
}
& (Join-Path $PSScriptRoot 'prepare-capture-runtime.ps1') -EngineRoot $engineDir
$githubDir=Join-Path $PSScriptRoot 'github'
if(-not (Test-Path -LiteralPath (Join-Path $githubDir 'gh.exe'))){
 $archive=Get-VerifiedArchive 'github-cli-2.103.3' $manifest.githubCli
 $extraction=Join-Path $cacheDir 'github-cli-extracted'
 Expand-Archive -LiteralPath $archive -DestinationPath $extraction -Force
 New-Item -ItemType Directory -Path $githubDir -Force | Out-Null
 Copy-Item -LiteralPath (Join-Path $extraction 'bin/gh.exe') -Destination (Join-Path $githubDir 'gh.exe')
 Copy-Item -LiteralPath (Join-Path $extraction 'LICENSE') -Destination (Join-Path $githubDir 'LICENSE')
}
if($FfmpegBin){
 $FfmpegBin=(Resolve-Path -LiteralPath $FfmpegBin).Path
 $vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
 $vs=& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
 $vc=Get-ChildItem -LiteralPath (Join-Path $vs 'VC/Tools/MSVC') -Directory | Sort-Object Name -Descending | Select-Object -First 1
 $dumpbin=Join-Path $vc.FullName 'bin/Hostx64/x64/dumpbin.exe'
 $pending=New-Object 'System.Collections.Generic.Queue[string]'
 $copied=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
 foreach($file in @('ffmpeg.exe','ffprobe.exe')){$pending.Enqueue($file)}
 while($pending.Count){
  $name=$pending.Dequeue();if(-not $copied.Add($name)){continue}
  $source=Join-Path $FfmpegBin $name
  if(-not (Test-Path -LiteralPath $source)){throw "Missing FFmpeg dependency $name"}
  Copy-Item -LiteralPath $source -Destination (Join-Path $PSScriptRoot $name) -Force
  $imports=& $dumpbin /nologo /DEPENDENTS $source
  if($LASTEXITCODE){throw "Cannot inspect FFmpeg dependency $name"}
  foreach($line in $imports){if($line -match '^\s+([A-Za-z0-9_.+-]+\.dll)\s*$'){$dependency=$matches[1];if(Test-Path -LiteralPath (Join-Path $FfmpegBin $dependency)){$pending.Enqueue($dependency)}}}
 }
 Write-Output "Copied $($copied.Count) FFmpeg executable/runtime files"
}
if(-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'ffmpeg.exe'))){throw 'Provide -FfmpegBin with a Windows FFmpeg shared build (CI uses MSYS2 UCRT64).'}
& (Join-Path $PSScriptRoot 'ffmpeg.exe') -version | Select-Object -First 1
if($LASTEXITCODE){throw 'FFmpeg runtime verification failed'}
