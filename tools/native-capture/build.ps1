$ErrorActionPreference='Stop'
$sourceDir=$PSScriptRoot
$projectDir=Split-Path (Split-Path $sourceDir)
$engineBin=Join-Path $projectDir 'engine\obs\bin\64bit'
& (Join-Path $projectDir 'tools/prepare-capture-runtime.ps1') -EngineRoot (Join-Path $projectDir 'engine/obs')
$vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vs=& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if(-not $vs){throw 'Visual C++ build tools are required.'}
$vc=Get-ChildItem -LiteralPath (Join-Path $vs 'VC\Tools\MSVC') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$sdkRoot=Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10'
$sdk=Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'Include') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$compilerDir=Join-Path $vc.FullName 'bin\Hostx64\x64'
& (Join-Path $projectDir 'tools/prepare-vc-runtime.ps1') -EngineRoot (Join-Path $projectDir 'engine/obs') -VisualStudioRoot $vs
foreach($companion in @('graphics-hook32.dll','inject-helper32.exe','get-graphics-offsets32.exe')){
 $binary=Join-Path $projectDir "engine/obs/core/win-capture/data/$companion"
 $imports=& (Join-Path $compilerDir 'dumpbin.exe') /nologo /DEPENDENTS $binary
 if($LASTEXITCODE){throw "Cannot inspect 32-bit capture companion $companion"}
 if(($imports -join "`n") -match '(?im)^\s+(?:MSVC[PR][0-9A-Za-z_]*|VCRUNTIME[0-9A-Za-z_]*|CONCRT[0-9A-Za-z_]*|api-ms-win-crt-[A-Za-z0-9-]+)\.dll\s*$'){throw "32-bit capture companion $companion needs a separately reviewed x86 CRT deployment"}
}
$env:PATH=$compilerDir+';'+$env:PATH
$env:INCLUDE=@((Join-Path $vc.FullName 'include'),(Join-Path $sdk.FullName 'ucrt'),(Join-Path $sdk.FullName 'shared'),(Join-Path $sdk.FullName 'um'),(Join-Path $sdk.FullName 'winrt')) -join ';'
$env:LIB=@((Join-Path $vc.FullName 'lib\x64'),(Join-Path $sdkRoot "Lib\$($sdk.Name)\ucrt\x64"),(Join-Path $sdkRoot "Lib\$($sdk.Name)\um\x64")) -join ';'
$buildDir=Join-Path $sourceDir 'build'
New-Item -ItemType Directory -Path $buildDir -Force | Out-Null
$exports=& (Join-Path $compilerDir 'dumpbin.exe') /nologo /exports (Join-Path $engineBin 'obs.dll')
$names=@($exports | ForEach-Object {if($_ -match '^\s+\d+\s+[0-9A-F]+\s+[0-9A-F]+\s+(\w+)'){ $matches[1] }})
if($names.Count -lt 500){throw 'Cannot read libobs exports.'}
$definition=Join-Path $buildDir 'obs.def'
@('LIBRARY obs.dll','EXPORTS')+$names | Set-Content -LiteralPath $definition -Encoding ascii
& (Join-Path $compilerDir 'lib.exe') /nologo /machine:x64 "/def:$definition" "/out:$(Join-Path $buildDir 'obs.lib')"
if($LASTEXITCODE){throw 'Generating libobs import library failed.'}
$output=Join-Path $projectDir 'tools\Ember.Capture.exe'
& (Join-Path $compilerDir 'cl.exe') /nologo /std:c++17 /EHsc /MD /O2 /W3 /utf-8 /D_CRT_SECURE_NO_WARNINGS "/I$sourceDir" "/I$(Join-Path $sourceDir 'vendor\obs-33.0.1\libobs')" (Join-Path $sourceDir 'main.cpp') "/Fo:$(Join-Path $buildDir 'main.obj')" "/Fe:$output" /link /SUBSYSTEM:CONSOLE /INCREMENTAL:NO (Join-Path $buildDir 'obs.lib') ole32.lib uuid.lib user32.lib
if($LASTEXITCODE){throw 'Building Ember.Capture failed.'}
Copy-Item -LiteralPath $output -Destination (Join-Path $engineBin 'Ember.Capture.exe') -Force
Write-Output "Built $output"
