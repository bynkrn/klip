$ErrorActionPreference='Stop'
$project=Split-Path (Split-Path $PSScriptRoot)
$build=Join-Path $project 'tools/build-deps/durable-recovery'
$vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vs=& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
$vc=Get-ChildItem -LiteralPath (Join-Path $vs 'VC/Tools/MSVC') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$sdkRoot=Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10'
$sdk=Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'Include') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$compilerDir=Join-Path $vc.FullName 'bin/Hostx64/x64'
$env:PATH=$compilerDir+';'+$env:PATH
$env:INCLUDE=@((Join-Path $vc.FullName 'include'),(Join-Path $sdk.FullName 'ucrt'),(Join-Path $sdk.FullName 'shared'),(Join-Path $sdk.FullName 'um'),(Join-Path $sdk.FullName 'winrt')) -join ';'
$env:LIB=@((Join-Path $vc.FullName 'lib/x64'),(Join-Path $sdkRoot "Lib/$($sdk.Name)/ucrt/x64"),(Join-Path $sdkRoot "Lib/$($sdk.Name)/um/x64")) -join ';'
New-Item -ItemType Directory -Path $build -Force | Out-Null
$runtime=Join-Path $build 'runtime'
if(-not (Test-Path -LiteralPath (Join-Path $runtime 'bin/64bit/obs.dll'))){
 New-Item -ItemType Directory -Path $runtime -Force | Out-Null
 foreach($part in @('bin','core','data')){Copy-Item -LiteralPath (Join-Path $project "engine/obs/$part") -Destination $runtime -Recurse -Force}
}
if(-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'build/obs.lib'))){
 $exports=& (Join-Path $compilerDir 'dumpbin.exe') /nologo /exports (Join-Path $runtime 'bin/64bit/obs.dll')
 $names=@($exports | ForEach-Object {if($_ -match '^\s+\d+\s+[0-9A-F]+\s+[0-9A-F]+\s+(\w+)'){ $matches[1] }})
 if($names.Count -lt 500){throw 'Cannot read libobs exports'}
 @('LIBRARY obs.dll','EXPORTS')+$names | Set-Content -LiteralPath (Join-Path $build 'obs.def') -Encoding ascii
 & (Join-Path $compilerDir 'lib.exe') /nologo /machine:x64 "/def:$(Join-Path $build 'obs.def')" "/out:$(Join-Path $build 'obs.lib')"
 if($LASTEXITCODE){throw 'Cannot generate isolated libobs import library'}
}

& (Join-Path $compilerDir 'cl.exe') /nologo /std:c++17 /EHsc /MD /O2 /W3 /utf-8 /D_CRT_SECURE_NO_WARNINGS "/I$PSScriptRoot" "/I$(Join-Path $PSScriptRoot 'vendor/obs-33.0.1/libobs')" (Join-Path $PSScriptRoot 'main.cpp') "/Fo:$(Join-Path $build 'main.obj')" "/Fe:$(Join-Path $build 'runtime/bin/64bit/Ember.Capture.exe')" /link /SUBSYSTEM:CONSOLE /INCREMENTAL:NO $(if(Test-Path -LiteralPath (Join-Path $build 'obs.lib')){Join-Path $build 'obs.lib'}else{Join-Path $PSScriptRoot 'build/obs.lib'}) ole32.lib uuid.lib user32.lib
if($LASTEXITCODE){throw 'Isolated capture build failed'}

& (Join-Path $compilerDir 'cl.exe') /nologo /std:c++17 /EHsc /MD /O2 /W4 /WX /utf-8 (Join-Path $PSScriptRoot 'durable-recovery.test.cpp') "/Fo:$(Join-Path $build 'durable-recovery-test.obj')" "/Fe:$(Join-Path $build 'durable-recovery-test.exe')"
if($LASTEXITCODE){throw 'Durable recovery fixture build failed'}
