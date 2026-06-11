# Tenta iniciar o Docker Desktop e aguarda o engine ficar pronto (até 120s).
$exe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
if (Test-Path $exe) {
  Start-Process -FilePath $exe | Out-Null
  Write-Host "launched Docker Desktop"
} else {
  Write-Host "NOT_FOUND: $exe"; exit 2
}
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 3
  $null = & docker info 2>$null
  if ($LASTEXITCODE -eq 0) { Write-Host "ENGINE_READY after $($i*3)s"; exit 0 }
}
Write-Host "ENGINE_NOT_READY"; exit 1
