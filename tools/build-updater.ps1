$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$source = Join-Path $PSScriptRoot 'update-install.cs'
$output = Join-Path $PSScriptRoot 'update-install.exe'
& $compiler /nologo /target:exe /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll "/out:$output" $source
if ($LASTEXITCODE -ne 0) { throw 'Update installer build failed' }
