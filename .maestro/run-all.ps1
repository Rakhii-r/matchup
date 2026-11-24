# Runs each Maestro flow in its own session, so a driver crash on one
# screen (Games tab radar animation) doesn't fail every flow after it.
# Usage (from uploads/matchup):  powershell -File .maestro/run-all.ps1
$maestro = "$env:USERPROFILE\.maestro\bin\maestro.bat"
$results = @()
Get-ChildItem "$PSScriptRoot\0*.yaml" | Sort-Object Name | ForEach-Object {
  & $maestro test $_.FullName | Out-Null
  $ok = $LASTEXITCODE -eq 0
  if (-not $ok) { & $maestro test $_.FullName | Out-Null; $ok = $LASTEXITCODE -eq 0 }  # one retry
  $results += [pscustomobject]@{ Flow = $_.BaseName; Result = $(if ($ok) { 'PASS' } else { 'FAIL' }) }
}
$results | Format-Table -AutoSize
if ($results.Result -contains 'FAIL') { exit 1 }
