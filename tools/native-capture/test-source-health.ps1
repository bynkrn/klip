$ErrorActionPreference='Stop'
$vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vs=& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
$vc=Get-ChildItem -LiteralPath (Join-Path $vs 'VC\Tools\MSVC') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$sdkRoot=Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10'
$sdk=Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'Include') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$env:INCLUDE=@((Join-Path $vc.FullName 'include'),(Join-Path $sdk.FullName 'ucrt'),(Join-Path $sdk.FullName 'shared'),(Join-Path $sdk.FullName 'um')) -join ';'
$env:LIB=@((Join-Path $vc.FullName 'lib\x64'),(Join-Path $sdkRoot "Lib\$($sdk.Name)\ucrt\x64"),(Join-Path $sdkRoot "Lib\$($sdk.Name)\um\x64")) -join ';'
$build=Join-Path $PSScriptRoot 'build'
New-Item -ItemType Directory -Path $build -Force | Out-Null
$binary=Join-Path $build 'source-health.test.exe'
& (Join-Path $vc.FullName 'bin\Hostx64\x64\cl.exe') /nologo /std:c++17 /EHsc /MD /O2 /W3 /utf-8 (Join-Path $PSScriptRoot 'source-health.test.cpp') "/Fo:$(Join-Path $build 'source-health.test.obj')" "/Fe:$binary" /link /INCREMENTAL:NO user32.lib
if($LASTEXITCODE){throw 'Source health tests did not compile.'}
& $binary
if($LASTEXITCODE){throw 'Source health tests failed.'}
