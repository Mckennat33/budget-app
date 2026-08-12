$p = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if ($p) {
  $p.OwningProcess | ForEach-Object {
    try {
      Stop-Process -Id $_ -Force -ErrorAction Stop
      Write-Output "Stopped PID $_"
    } catch {
      Write-Output "Failed to stop PID $_ : $($_.Exception.Message)"
    }
  }
} else {
  Write-Output 'No process listening on port 3000 found.'
}
