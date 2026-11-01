param([Parameter(Mandatory=$true)][string]$EngineRoot,[Parameter(Mandatory=$true)][string]$VisualStudioRoot)
$ErrorActionPreference='Stop'
foreach($value in @($EngineRoot,$VisualStudioRoot)){if($value -notmatch '^[A-Za-z]:[\\/]'){throw 'Absolute local runtime/source directories are required'}}
$runtimeEngine=[IO.Path]::GetFullPath($EngineRoot).TrimEnd('\','/')
$visualStudio=[IO.Path]::GetFullPath($VisualStudioRoot).TrimEnd('\','/')
if($runtimeEngine.Length -lt 4 -or -not [IO.Directory]::Exists($runtimeEngine)){throw 'EngineRoot must be an existing engine directory'}
function Assert-RegularPath([string]$candidate){
 $current=[IO.Path]::GetFullPath($candidate)
 while($current){$item=Get-Item -LiteralPath $current -Force -ErrorAction SilentlyContinue;if($item -and (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.LinkType -eq 'HardLink')){throw "Runtime link/reparse paths are not supported: $current"};$current=[IO.Path]::GetDirectoryName($current)}
}
function Assert-Target([string]$candidate){if(-not [IO.Path]::GetFullPath($candidate).StartsWith($runtimeEngine+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Runtime destination escaped EngineRoot'};Assert-RegularPath $candidate}
function Assert-X64([string]$file){
 $stream=[IO.File]::OpenRead($file);$reader=New-Object IO.BinaryReader($stream)
 try{if($stream.Length -lt 70 -or $reader.ReadUInt16() -ne 0x5A4D){throw "Invalid runtime PE image: $file"};$stream.Position=60;$offset=$reader.ReadUInt32();if($offset -gt $stream.Length-6){throw "Invalid PE offset: $file"};$stream.Position=$offset;if($reader.ReadUInt32() -ne 0x4550 -or $reader.ReadUInt16() -ne 0x8664){throw "Runtime must be x64: $file"}}finally{$reader.Dispose();$stream.Dispose()}
}
Assert-RegularPath $runtimeEngine;Assert-RegularPath $visualStudio
$redistParent=Join-Path $visualStudio 'VC/Redist/MSVC'
$versions=@(Get-ChildItem -LiteralPath $redistParent -Directory | Where-Object {$_.Name -match '^\d+\.\d+\.\d+$'} | Sort-Object {[version]$_.Name} -Descending)
$crt=$null
foreach($version in $versions){$candidate=Join-Path $version.FullName 'x64';if([IO.Directory]::Exists($candidate)){$crt=Get-ChildItem -LiteralPath $candidate -Directory -Filter 'Microsoft.VC*.CRT' | Sort-Object Name -Descending | Select-Object -First 1;if($crt){break}}}
if(-not $crt){throw 'Visual Studio x64 redistributable CRT directory was not found'}
Assert-RegularPath $crt.FullName
$runtimeFiles=@(Get-ChildItem -LiteralPath $crt.FullName -File -Filter '*.dll')
foreach($name in @('msvcp140.dll','vcruntime140.dll','vcruntime140_1.dll')){if(-not ($runtimeFiles | Where-Object {$_.Name -ieq $name})){throw "Required x64 runtime is missing: $name"}}
$engineBin=Join-Path $runtimeEngine 'bin/64bit';$notice=Join-Path $engineBin 'Microsoft-VC-Runtime-NOTICE.txt'
Assert-Target $engineBin;Assert-Target $notice
foreach($file in $runtimeFiles){Assert-RegularPath $file.FullName;Assert-X64 $file.FullName;Assert-Target (Join-Path $engineBin $file.Name)}
# Only the licensed x64 release CRT is copied. Never place x86 CRT files beside
# the x64 service; stock 32-bit injection companions are checked by build.ps1.
[void][IO.Directory]::CreateDirectory($engineBin)
foreach($file in $runtimeFiles){[IO.File]::Copy($file.FullName,(Join-Path $engineBin $file.Name),$true)}
$copyright=[Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $crt.FullName 'vcruntime140.dll')).LegalCopyright
if(-not $copyright){$copyright='Microsoft Corporation. All rights reserved.'}
$text=@"
Microsoft Visual C++ Runtime (x64)
$copyright

These unmodified app-local release runtime DLLs support Klip.Capture and libobs.
Copied from the licensed Visual Studio redistributable directory:
VC/Redist/MSVC/$($version.Name)/x64/$($crt.Name)

Redistribution is subject to the Microsoft Software License Terms for the
licensed Visual Studio installation. These runtime files are not relicensed.
Microsoft Visual Studio distributable code list and deployment guidance:
https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution
https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files
"@
[IO.File]::WriteAllText($notice,$text,(New-Object Text.UTF8Encoding($false)))
Write-Output "Prepared $($runtimeFiles.Count) x64 Visual C++ runtime DLLs and Microsoft notice"
