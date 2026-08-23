$ErrorActionPreference = "Stop"

$appRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\release\win-unpacked")).Path
$appExecutable = Join-Path $appRoot "Mboo Code.exe"
$dataDirectory = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..\build")).Path "unpacked-smoke-data-$PID"
$electronDataDirectory = Join-Path $dataDirectory "electron"
New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null

function Get-PackagedProcesses {
  return @(Get-Process -Name "Mboo Code", "java", "node" -ErrorAction SilentlyContinue |
    Where-Object {
      $processPath = try { $_.Path } catch { $null }
      $processPath -and $processPath.StartsWith($appRoot, [StringComparison]::OrdinalIgnoreCase)
    })
}

function Wait-ForReady {
  param([Parameter(Mandatory = $true)][int]$ProcessId)

  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
      throw "应用在 ready 前退出，PID：$ProcessId"
    }
    $log = Get-ChildItem -LiteralPath $dataDirectory -Filter "desktop-startup.log" -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($log -and (Select-String -LiteralPath $log.FullName -Pattern "phase=ready" -Quiet)) {
      return
    }
    Start-Sleep -Seconds 1
  }
  throw "等待桌面服务 ready 超时"
}

function Wait-ForPackagedProcessesExit {
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ((Get-PackagedProcesses).Count -eq 0) {
      return
    }
    Start-Sleep -Seconds 1
  }
  throw "随包进程未在 30 秒内退出"
}

$originalAppData = $env:MBOO_DESKTOP_APP_DATA_DIR
$env:MBOO_DESKTOP_APP_DATA_DIR = $dataDirectory
try {
  $log = Get-ChildItem -LiteralPath $dataDirectory -Filter "desktop-startup.log" -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($log) { Remove-Item -LiteralPath $log.FullName -Force }

  Write-Host "Validating unpacked graceful shutdown"
  $gracefulProcess = Start-Process -FilePath $appExecutable -ArgumentList @("--user-data-dir=$electronDataDirectory", "--smoke-exit-after-ready") -WindowStyle Hidden -PassThru
  Write-Host "Graceful root PID: $($gracefulProcess.Id)"
  Wait-ForReady -ProcessId $gracefulProcess.Id
  if (-not $gracefulProcess.WaitForExit(30000)) {
    throw "应用正常退出测试超时，PID：$($gracefulProcess.Id)"
  }
  Wait-ForPackagedProcessesExit

  $log = Get-ChildItem -LiteralPath $dataDirectory -Filter "desktop-startup.log" -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($log) { Remove-Item -LiteralPath $log.FullName -Force }

  Write-Host "Validating unpacked parent crash cleanup"
  $crashProcess = Start-Process -FilePath $appExecutable -ArgumentList @("--user-data-dir=$electronDataDirectory", "--smoke-parent-crash") -WindowStyle Hidden -PassThru
  Wait-ForReady -ProcessId $crashProcess.Id
  & taskkill.exe /PID $crashProcess.Id /F | Out-Null
  Wait-ForPackagedProcessesExit
  Write-Host "Windows unpacked smoke test passed"
} finally {
  Get-PackagedProcesses | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
  if ($null -eq $originalAppData) {
    Remove-Item Env:MBOO_DESKTOP_APP_DATA_DIR -ErrorAction SilentlyContinue
  } else {
    $env:MBOO_DESKTOP_APP_DATA_DIR = $originalAppData
  }
}
