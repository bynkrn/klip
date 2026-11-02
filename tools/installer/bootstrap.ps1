$ErrorActionPreference='Stop'
$cache=Join-Path (Split-Path -Parent $PSScriptRoot) 'build-deps/nsis'
$archive=Join-Path $cache 'nsis-3.12.zip'
$compiler=Join-Path $cache 'nsis-3.12/makensis.exe'
$expected='56581F90DB321581C5381193D796FFFCF2D24B2F8FED2160A6C6A3BAA67F2C4F'
New-Item -ItemType Directory -Path $cache -Force | Out-Null
if(-not(Test-Path -LiteralPath $archive)){
 & curl.exe -fL --silent --show-error --max-time 90 -o "$archive.download" 'https://downloads.sourceforge.net/project/nsis/NSIS%203/3.12/nsis-3.12.zip'
 if($LASTEXITCODE -ne 0){throw 'NSIS download failed'}
 if((Get-FileHash -LiteralPath "$archive.download" -Algorithm SHA256).Hash -ne $expected){throw 'NSIS download checksum mismatch'}
 Move-Item -LiteralPath "$archive.download" -Destination $archive
}
if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected){throw 'Cached NSIS checksum mismatch'}
if(-not(Test-Path -LiteralPath $compiler)){Expand-Archive -LiteralPath $archive -DestinationPath $cache}
if(-not(Test-Path -LiteralPath $compiler)){throw 'NSIS compiler missing'}
$compiler
