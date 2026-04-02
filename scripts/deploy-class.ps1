param(
  [Parameter(Mandatory = $true)]
  [string]$Class,

  [string[]]$DeviceNames,

  [switch]$NoWait
)

$ErrorActionPreference = "Stop"

function Read-KeyValueFile {
  param([string]$Path)

  $result = @{}
  foreach ($rawLine in Get-Content -LiteralPath $Path) {
    $line = $rawLine.Trim()
    if (-not $line -or $line.StartsWith("#")) {
      continue
    }

    $separatorIndex = $line.IndexOf("=")
    if ($separatorIndex -lt 0) {
      continue
    }

    $key = $line.Substring(0, $separatorIndex).Trim()
    $value = $line.Substring($separatorIndex + 1).Trim()
    if ($key) {
      $result[$key] = $value
    }
  }

  return $result
}

function Require-Tool {
  param(
    [string]$Label,
    [string]$PreferredPath
  )

  if ($PreferredPath -and (Test-Path -LiteralPath $PreferredPath)) {
    return (Resolve-Path -LiteralPath $PreferredPath).Path
  }

  $command = Get-Command $Label -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  throw "Required tool not found: $Label"
}

function Ensure-Directory {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Invoke-CloudCliJson {
  param(
    [string]$CloudCliPath,
    [string[]]$Arguments
  )

  $output = & $CloudCliPath @Arguments --format json
  if (-not $output) {
    throw "No output returned from arduino-cloud-cli."
  }

  return $output | ConvertFrom-Json
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$fleetConfigPath = Join-Path $projectRoot "config\\fleet.json"
$localEnvPath = Join-Path $projectRoot "secure\\local.env"
$privateRoot = Join-Path $projectRoot "private"
$toolsRoot = Join-Path $privateRoot "tools"
$cloudCliPreferred = Join-Path $toolsRoot "arduino-cloud-cli\\arduino-cloud-cli.exe"
$arduinoCliPreferred = Join-Path $toolsRoot "arduino-cli\\arduino-cli.exe"
$arduinoCliFallback = "C:\\Program Files\\Arduino CLI\\arduino-cli.exe"

if (-not (Test-Path -LiteralPath $fleetConfigPath)) {
  throw "Missing fleet config: $fleetConfigPath"
}

if (-not (Test-Path -LiteralPath $localEnvPath)) {
  throw "Missing local env: $localEnvPath"
}

$fleet = Get-Content -LiteralPath $fleetConfigPath -Raw | ConvertFrom-Json
$envConfig = Read-KeyValueFile -Path $localEnvPath

if (Test-Path -LiteralPath $arduinoCliPreferred) {
  $arduinoCliPath = (Resolve-Path -LiteralPath $arduinoCliPreferred).Path
} else {
  $arduinoCliPath = Require-Tool -Label "arduino-cli.exe" -PreferredPath $arduinoCliFallback
}
$cloudCliPath = Require-Tool -Label "arduino-cloud-cli.exe" -PreferredPath $cloudCliPreferred

$classConfig = $fleet.classes.$Class
if (-not $classConfig) {
  throw "Unknown class '$Class' in fleet config."
}

$devices = @($fleet.devices | Where-Object {
  $_.class -eq $Class -and $_.enabled -ne $false -and ($DeviceNames.Count -eq 0 -or $DeviceNames -contains $_.name)
})

if ($devices.Count -eq 0) {
  throw "No enabled devices matched class '$Class'."
}

$env:ARDUINO_CLOUD_CLIENT = $envConfig["ARDUINO_UNI_CLIENT_ID"]
$env:ARDUINO_CLOUD_SECRET = $envConfig["ARDUINO_UNI_CLIENT_SECRET"]
$env:ARDUINO_CLOUD_ORGANIZATION = $envConfig["ARDUINO_UNI_ORG_ID"]

if (-not $env:ARDUINO_CLOUD_CLIENT -or -not $env:ARDUINO_CLOUD_SECRET) {
  throw "Missing Arduino Cloud API credentials in secure/local.env."
}

$sketchFolder = Join-Path $projectRoot ("sketches\\" + $classConfig.sketch)
$sharedSketchPath = Join-Path $sketchFolder ($classConfig.sketch + ".ino")

if (-not (Test-Path -LiteralPath $sharedSketchPath)) {
  throw "Shared sketch not found: $sharedSketchPath"
}

$deployRoot = Join-Path $privateRoot "deploy"
Ensure-Directory -Path $deployRoot

$results = @()

foreach ($device in $devices) {
  $deviceStartedAt = (Get-Date).ToUniversalTime()
  $deviceConfigRoot = Join-Path $projectRoot ("secure\\device-configs\\" + $device.name)
  $thingPropertiesPath = Join-Path $deviceConfigRoot "thingProperties.h"
  $secretsPath = Join-Path $deviceConfigRoot "arduino_secrets.h"

  if (-not (Test-Path -LiteralPath $thingPropertiesPath)) {
    throw "Missing thingProperties.h for $($device.name): $thingPropertiesPath"
  }
  if (-not (Test-Path -LiteralPath $secretsPath)) {
    throw "Missing arduino_secrets.h for $($device.name): $secretsPath"
  }
  if (-not $device.fqbn) {
    throw "Missing fqbn for $($device.name) in config/fleet.json"
  }

  $deviceBuildRoot = Join-Path $deployRoot $device.name
  $deviceSketchFolder = Join-Path $deviceBuildRoot ("build-" + $device.name + "-" + $Class)
  $buildOutputFolder = Join-Path $deviceBuildRoot "arduino-build"

  if (Test-Path -LiteralPath $deviceBuildRoot) {
    Remove-Item -Recurse -Force -LiteralPath $deviceBuildRoot
  }

  Ensure-Directory -Path $deviceSketchFolder
  Ensure-Directory -Path $buildOutputFolder

  Copy-Item -LiteralPath $sharedSketchPath -Destination (Join-Path $deviceSketchFolder ("build-" + $device.name + "-" + $Class + ".ino"))
  Copy-Item -LiteralPath $thingPropertiesPath -Destination (Join-Path $deviceSketchFolder "thingProperties.h")
  Copy-Item -LiteralPath $secretsPath -Destination (Join-Path $deviceSketchFolder "arduino_secrets.h")

  Write-Host "Compiling $($device.name) ($($device.fqbn))..."
  & $arduinoCliPath compile --fqbn $device.fqbn --build-path $buildOutputFolder $deviceSketchFolder

  $binaryPath = Join-Path $buildOutputFolder ("build-" + $device.name + "-" + $Class + ".ino.bin")
  if (-not (Test-Path -LiteralPath $binaryPath)) {
    throw "Compiled binary not found for $($device.name): $binaryPath"
  }

  Write-Host "Scheduling OTA for $($device.name)..."
  $ota = Invoke-CloudCliJson -CloudCliPath $cloudCliPath -Arguments @(
    "ota",
    "upload",
    "--device-id", $device.deviceId,
    "--file", $binaryPath
  )

  $status = $ota.status
  if (-not $NoWait) {
    do {
      Start-Sleep -Seconds 10
      $ota = Invoke-CloudCliJson -CloudCliPath $cloudCliPath -Arguments @(
        "ota",
        "status",
        "--ota-id", $ota.id
      )
      $status = $ota.status
      Write-Host "$($device.name) OTA status: $status"
    } while ($status -eq "pending" -or $status -eq "in_progress")
  }

  $deviceFinishedAt = (Get-Date).ToUniversalTime()

  $results += [PSCustomObject]@{
    name = $device.name
    class = $Class
    otaId = $ota.id
    status = $status
    deviceId = $device.deviceId
    binary = $binaryPath
    startedAt = $deviceStartedAt.ToString("o")
    finishedAt = $deviceFinishedAt.ToString("o")
    durationSeconds = [Math]::Round(($deviceFinishedAt - $deviceStartedAt).TotalSeconds, 1)
  }
}

$results | ConvertTo-Json -Depth 5
