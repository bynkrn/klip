$ErrorActionPreference='Stop'
$vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vs=& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
$vc=Get-ChildItem -LiteralPath (Join-Path $vs 'VC\Tools\MSVC') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$sdkRoot=Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10'
$sdk=Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'Include') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$compilerDir=Join-Path $vc.FullName 'bin\Hostx64\x64'
$env:PATH=$compilerDir+';'+$env:PATH
$env:INCLUDE=@((Join-Path $vc.FullName 'include'),(Join-Path $sdk.FullName 'ucrt'),(Join-Path $sdk.FullName 'shared'),(Join-Path $sdk.FullName 'um'),(Join-Path $sdk.FullName 'winrt')) -join ';'
$env:LIB=@((Join-Path $vc.FullName 'lib\x64'),(Join-Path $sdkRoot "Lib\$($sdk.Name)\ucrt\x64"),(Join-Path $sdkRoot "Lib\$($sdk.Name)\um\x64")) -join ';'
$vendor=Join-Path $PSScriptRoot '..\..\tools\native-capture\vendor'
& (Join-Path $compilerDir 'cl.exe') /nologo /std:c++17 /EHsc /MD /O2 /W3 /utf-8 "/I$vendor" (Join-Path $PSScriptRoot 'probe.cpp') "/Fo:$(Join-Path $PSScriptRoot 'probe.obj')" "/Fe:$(Join-Path $PSScriptRoot 'KlipAvSyncProbe.exe')" /link /SUBSYSTEM:CONSOLE /INCREMENTAL:NO ole32.lib user32.lib gdi32.lib uuid.lib
if($LASTEXITCODE){throw 'AV sync probe build failed.'}
& (Join-Path $compilerDir 'cl.exe') /nologo /std:c++17 /EHsc /MD /O2 /W3 /utf-8 "/I$vendor" (Join-Path $PSScriptRoot 'capture-reference.cpp') "/Fo:$(Join-Path $PSScriptRoot 'capture-reference.obj')" "/Fe:$(Join-Path $PSScriptRoot 'KlipAvClockReader.exe')" /link /SUBSYSTEM:CONSOLE /INCREMENTAL:NO ole32.lib uuid.lib mmdevapi.lib
if($LASTEXITCODE){throw 'AV packet reference build failed.'}
& (Join-Path $compilerDir 'cl.exe') /nologo /std:c++17 /EHsc /MD /O2 /W3 /utf-8 "/I$vendor" (Join-Path $PSScriptRoot 'session-info.cpp') "/Fo:$(Join-Path $PSScriptRoot 'session-info.obj')" "/Fe:$(Join-Path $PSScriptRoot 'KlipAvSessionInfo.exe')" /link /SUBSYSTEM:CONSOLE /INCREMENTAL:NO ole32.lib uuid.lib
if($LASTEXITCODE){throw 'AV session diagnostics build failed.'}
