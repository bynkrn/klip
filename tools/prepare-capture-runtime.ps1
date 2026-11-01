param([Parameter(Mandatory=$true)][string]$EngineRoot)
$ErrorActionPreference='Stop'
if($EngineRoot -notmatch '^[A-Za-z]:[\\/]'){throw 'EngineRoot must be an absolute local drive path'}
$captureRoot=[IO.Path]::GetFullPath($EngineRoot).TrimEnd('\','/')
if($captureRoot.Length -lt 4 -or -not [IO.Directory]::Exists($captureRoot)){throw 'EngineRoot must be an existing application engine directory'}
$modules=@('win-capture','win-wasapi','obs-nvenc','obs-ffmpeg')
$companions=@('graphics-hook32.dll','graphics-hook64.dll','inject-helper32.exe','inject-helper64.exe','get-graphics-offsets32.exe','get-graphics-offsets64.exe')
$files=New-Object 'System.Collections.Generic.List[object]'
$directories=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
function Assert-Scoped([string]$candidate){
 $full=[IO.Path]::GetFullPath($candidate)
 if(-not $full.StartsWith($captureRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw "Runtime target escapes EngineRoot: $candidate"}
}
function Assert-NoLinks([string]$candidate){
 $current=[IO.Path]::GetFullPath($candidate)
 while($current){
  $item=Get-Item -LiteralPath $current -Force -ErrorAction SilentlyContinue
  if($item -and (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.LinkType -eq 'HardLink')){throw "Runtime reparse/link paths are not supported: $current"}
  $current=[IO.Path]::GetDirectoryName($current)
 }
}
function Add-File([string]$source,[string]$target){
 Assert-Scoped $source;Assert-Scoped $target;Assert-NoLinks $source;Assert-NoLinks $target
 if(-not [IO.File]::Exists($source)){throw "Required capture runtime file is missing: $source"}
 $files.Add([PSCustomObject]@{Source=$source;Target=$target})
}
function Add-Tree([string]$source,[string]$target,[bool]$copy){
 Assert-Scoped $source;Assert-Scoped $target;Assert-NoLinks $source;Assert-NoLinks $target
 if(-not [IO.Directory]::Exists($source)){throw "Required capture runtime data is missing: $source"}
 if($copy){[void]$directories.Add($target)}
 foreach($item in Get-ChildItem -LiteralPath $source -Force){
  Assert-NoLinks $item.FullName
  $destination=Join-Path $target $item.Name
  if($item.PSIsContainer){Add-Tree $item.FullName $destination $copy}
  elseif($copy){Add-File $item.FullName $destination}
 }
}
function File-Digest([string]$file){
 $stream=[IO.File]::OpenRead($file);$hash=[Security.Cryptography.SHA256]::Create()
 try{return [BitConverter]::ToString($hash.ComputeHash($stream))}finally{$hash.Dispose();$stream.Dispose()}
}
Assert-NoLinks $captureRoot
# Validate the complete plan before creating or copying anything. Existing core
# data is accepted only as regular files when this checkout already moved stock.
foreach($module in $modules){
 $stockDll=Join-Path $captureRoot "obs-plugins/64bit/$module.dll"
 $stockData=Join-Path $captureRoot "data/obs-plugins/$module"
 $moduleRoot=Join-Path $captureRoot "core/$module"
 $targetDll=Join-Path $moduleRoot "$module.dll"
 $targetData=Join-Path $moduleRoot 'data'
 if([IO.File]::Exists($stockDll) -or [IO.Directory]::Exists($stockData)){
  Add-File $stockDll $targetDll;Add-Tree $stockData $targetData $true
  if($module -eq 'win-capture'){foreach($name in $companions){$required=Join-Path $stockData $name;Assert-NoLinks $required;if(-not [IO.File]::Exists($required)){throw "Required game hook companion is missing: $required"}}}
 }else{
  Assert-Scoped $targetDll;Assert-NoLinks $targetDll
  if(-not [IO.File]::Exists($targetDll)){throw "Stock and prepared capture module are both missing: $module"}
  Add-Tree $targetData $targetData $false
  if($module -eq 'win-capture'){foreach($name in $companions){if(-not [IO.File]::Exists((Join-Path $targetData $name))){throw "Prepared game hook companion is missing: $name"}}}
 }
}
foreach($directory in $directories){Assert-Scoped $directory;Assert-NoLinks $directory;[void][IO.Directory]::CreateDirectory($directory)}
foreach($file in $files){
 Assert-Scoped $file.Target;Assert-NoLinks $file.Target
 $parent=[IO.Path]::GetDirectoryName($file.Target);[void][IO.Directory]::CreateDirectory($parent)
 if([IO.File]::Exists($file.Target) -and (File-Digest $file.Source) -eq (File-Digest $file.Target)){continue}
 [IO.File]::Copy($file.Source,$file.Target,$true)
}
Write-Output 'Prepared four capture modules as portable core directories'
