param(
  [string]$InstallerPath
)

$ErrorActionPreference = "Stop"

function Start-AndWait {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [int]$TimeoutMs = 180000
  )

  $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit($TimeoutMs)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "进程执行超时：$FilePath"
  }
  return $process
}

function Wait-ForReady {
  param(
    [Parameter(Mandatory = $true)][string]$RootDirectory,
    [Parameter(Mandatory = $true)][int]$ProcessId
  )

  for ($attempt = 0; $attempt -lt 90; $attempt++) {
    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
      throw "Mboo Code 在启动完成前退出，PID：$ProcessId"
    }
    $log = Get-ChildItem -LiteralPath $RootDirectory -Filter "desktop-startup.log" -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($log -and (Select-String -LiteralPath $log.FullName -Pattern "phase=ready" -Quiet)) {
      return $log.FullName
    }
    Start-Sleep -Seconds 1
  }
  throw "90 秒内桌面服务未进入 ready：$RootDirectory"
}

function Wait-ForPackagedProcessesExit {
  param(
    [Parameter(Mandatory = $true)][string]$InstallDirectory
  )

  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $processes = Get-PackagedProcesses -InstallDirectory $InstallDirectory
    if (-not $processes) {
      return
    }
    Start-Sleep -Seconds 1
  }
  throw "安装目录中的应用进程未在 30 秒内清理：$InstallDirectory"
}

function Get-PackagedProcesses {
  param([Parameter(Mandatory = $true)][string]$InstallDirectory)

  return @(Get-Process -Name "Mboo Code", "java", "node" -ErrorAction SilentlyContinue |
    Where-Object {
      $processPath = try { $_.Path } catch { $null }
      $processPath -and $processPath.StartsWith($InstallDirectory, [StringComparison]::OrdinalIgnoreCase)
    })
}

function Assert-TemporaryPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$TemporaryRoot
  )

  $resolvedPath = [IO.Path]::GetFullPath($Path)
  $resolvedRoot = [IO.Path]::GetFullPath($TemporaryRoot).TrimEnd('\') + '\'
  if (-not $resolvedPath.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "测试目录不在临时根目录内：$resolvedPath"
  }
}

$temporaryRoot = if ($env:RUNNER_TEMP) { [IO.Path]::GetFullPath($env:RUNNER_TEMP) } else { [IO.Path]::GetFullPath([IO.Path]::GetTempPath()) }
$installDirectory = Join-Path $temporaryRoot "Mboo Code 安装测试"
$appDataRoot = Join-Path $temporaryRoot "Mboo Code 数据测试"
$electronDataRoot = Join-Path $appDataRoot "electron"
$appExecutable = Join-Path $installDirectory "Mboo Code.exe"
$uninstaller = Join-Path $installDirectory "Uninstall Mboo Code.exe"

Assert-TemporaryPath -Path $installDirectory -TemporaryRoot $temporaryRoot
Assert-TemporaryPath -Path $appDataRoot -TemporaryRoot $temporaryRoot

if ($InstallerPath) {
  $installer = Get-Item -LiteralPath $InstallerPath
} else {
  $installer = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot "..\release") -Filter "Mboo-Code-*-win-x64.exe" -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
}
if (-not $installer) {
  throw "找不到 Windows x64 NSIS 安装包"
}

$existingDefaultApp = Join-Path $env:LOCALAPPDATA "Programs\Mboo Code\Mboo Code.exe"
if (Test-Path -LiteralPath $existingDefaultApp) {
  throw "检测到已有 Mboo Code 安装，为避免覆盖用户安装已停止本机安装冒烟；请在干净 Windows 环境或 CI runner 执行：$existingDefaultApp"
}

Remove-Item -LiteralPath $installDirectory, $appDataRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $appDataRoot | Out-Null

Write-Host "Installing $($installer.FullName)"
$installProcess = Start-AndWait -FilePath $installer.FullName -Arguments @("/S", "/D=$installDirectory")
if ($installProcess.ExitCode -ne 0) {
  throw "NSIS 安装失败，退出码：$($installProcess.ExitCode)"
}
if (-not (Test-Path -LiteralPath $appExecutable)) {
  throw "安装完成后找不到 Mboo Code.exe：$appExecutable"
}

$originalDesktopAppData = $env:MBOO_DESKTOP_APP_DATA_DIR
$env:MBOO_DESKTOP_APP_DATA_DIR = $appDataRoot
try {
  Write-Host "Validating graceful shutdown"
  $gracefulProcess = Start-Process -FilePath $appExecutable -ArgumentList @("--user-data-dir=$electronDataRoot", "--smoke-exit-after-ready") -WindowStyle Hidden -PassThru
  Wait-ForReady -RootDirectory $appDataRoot -ProcessId $gracefulProcess.Id | Out-Null
  if (-not $gracefulProcess.WaitForExit(30000)) {
    throw "应用正常退出测试超时，PID：$($gracefulProcess.Id)"
  }
  Wait-ForPackagedProcessesExit -InstallDirectory $installDirectory

  Remove-Item -LiteralPath (Join-Path $appDataRoot "logs\desktop-startup.log") -Force -ErrorAction SilentlyContinue
  Write-Host "Validating parent crash cleanup"
  $crashProcess = Start-Process -FilePath $appExecutable -ArgumentList @("--user-data-dir=$electronDataRoot", "--smoke-parent-crash") -WindowStyle Hidden -PassThru
  Wait-ForReady -RootDirectory $appDataRoot -ProcessId $crashProcess.Id | Out-Null
  & taskkill.exe /PID $crashProcess.Id /F | Out-Null
  Wait-ForPackagedProcessesExit -InstallDirectory $installDirectory
} finally {
  Get-PackagedProcesses -InstallDirectory $installDirectory | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
  if ($null -eq $originalDesktopAppData) {
    Remove-Item Env:MBOO_DESKTOP_APP_DATA_DIR -ErrorAction SilentlyContinue
  } else {
    $env:MBOO_DESKTOP_APP_DATA_DIR = $originalDesktopAppData
  }
}

if (-not (Test-Path -LiteralPath $uninstaller)) {
  throw "安装目录缺少卸载程序：$uninstaller"
}

Write-Host "Uninstalling from $installDirectory"
$uninstallProcess = Start-AndWait -FilePath $uninstaller -Arguments @("/S")
if ($uninstallProcess.ExitCode -ne 0) {
  throw "NSIS 卸载失败，退出码：$($uninstallProcess.ExitCode)"
}
if (Test-Path -LiteralPath $appExecutable) {
  throw "卸载完成后主程序仍存在：$appExecutable"
}

Remove-Item -LiteralPath $appDataRoot -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Windows installer smoke test passed"
