param([switch]$SkipRuntimeBuild,[string]$RuntimeDirectory='dist/installer-runtime/Ember-win32-x64')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
 if(-not $SkipRuntimeBuild){& (Join-Path $PSScriptRoot 'package.ps1') -OutDirectory 'dist/installer-runtime';if($LASTEXITCODE -ne 0){throw 'Runtime packaging failed'}}
 $runtime=(Resolve-Path -LiteralPath $RuntimeDirectory).Path
 $compiler=& (Join-Path $PSScriptRoot 'installer/bootstrap.ps1')
 $version=(Get-Content package.json -Raw|ConvertFrom-Json).version
 $output=Join-Path $projectRoot "dist/Ember-$version-Setup.exe"
 $manifest=Join-Path $projectRoot 'tools/build-deps/nsis/ember-uninstall.nsh'
 $node=(Get-Command node.exe).Source
 $uninstallExport=Join-Path $PSScriptRoot 'installer/export-uninstaller.js'
 node tools/installer/files.js $runtime $manifest
 if($LASTEXITCODE -ne 0){throw 'Installer manifest failed'}
 & $compiler /V2 /INPUTCHARSET UTF8 "/DVERSION=$version" "/DRUNTIME=$runtime" "/DOUTPUT=$output" "/DUNINSTALL_MANIFEST=$manifest" "/DNODE=$node" "/DUNINSTALL_EXPORT=$uninstallExport" tools/installer/ember.nsi
 if($LASTEXITCODE -ne 0){throw 'Installer compilation failed'}
 if(-not(Test-Path -LiteralPath (Join-Path $runtime 'Uninstall.exe'))){throw 'Update archive uninstaller missing'}
 $hash=(Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
 [IO.File]::WriteAllText("$output.sha256","$hash  $([IO.Path]::GetFileName($output))`n")
 Get-Item -LiteralPath $output | Select-Object FullName,Length
}finally{Pop-Location}
