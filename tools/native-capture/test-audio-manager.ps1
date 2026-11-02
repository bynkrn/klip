$ErrorActionPreference='Stop'
$vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vs=& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
$vc=Get-ChildItem -LiteralPath (Join-Path $vs 'VC/Tools/MSVC') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$sdkRoot=Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10'
$sdk=Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'Include') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$compilerDir=Join-Path $vc.FullName 'bin/Hostx64/x64'
$engineBin=Join-Path $PSScriptRoot '../../engine/obs/bin/64bit'
$env:PATH=$compilerDir+';'+$engineBin+';'+$env:PATH
$env:INCLUDE=@((Join-Path $vc.FullName 'include'),(Join-Path $sdk.FullName 'ucrt'),(Join-Path $sdk.FullName 'shared'),(Join-Path $sdk.FullName 'um'),(Join-Path $sdk.FullName 'winrt')) -join ';'
$env:LIB=@((Join-Path $vc.FullName 'lib/x64'),(Join-Path $sdkRoot "Lib/$($sdk.Name)/ucrt/x64"),(Join-Path $sdkRoot "Lib/$($sdk.Name)/um/x64")) -join ';'
$build=Join-Path $PSScriptRoot 'build'
New-Item -ItemType Directory -Path $build -Force | Out-Null
& (Join-Path $compilerDir 'cl.exe') /nologo /std:c++17 /EHsc /MD /O2 /W3 /utf-8 "/I$(Join-Path $PSScriptRoot 'vendor/obs-33.0.1/libobs')" (Join-Path $PSScriptRoot 'audio-manager.test.cpp') "/Fo:$(Join-Path $build 'audio-manager-test.obj')" "/Fe:$(Join-Path $build 'audio-manager-test.exe')" /link (Join-Path $build 'obs.lib') ole32.lib uuid.lib
if($LASTEXITCODE){throw 'Audio manager compilation failed'}
& (Join-Path $build 'audio-manager-test.exe')
if($LASTEXITCODE){throw 'Audio manager assertions failed'}
