param(
  [Parameter(Mandatory = $true)]
  [string]$Class,

  [string[]]$DeviceNames,

  [switch]$NoWait,

  [switch]$AllowUnsafeGit
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

function Invoke-Git {
  param(
    [string[]]$Arguments,
    [string]$RepositoryRoot
  )

  $output = & git -C $RepositoryRoot @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Git command failed: git $($Arguments -join ' ')`n$output"
  }

  return $output
}

function Test-RelevantDirtyPaths {
  param(
    [string]$RepositoryRoot
  )

  $statusLines = Invoke-Git -RepositoryRoot $RepositoryRoot -Arguments @("status", "--porcelain")
  if (-not $statusLines) {
    return @()
  }

  $relevantPrefixes = @(
    "sketches/",
    "config/",
    "scripts/",
    "server.js",
    "README.md",
    "MANUAL.md",
    "package.json"
  )

  $dirtyPaths = @()
  foreach ($line in $statusLines) {
    if (-not $line) {
      continue
    }

    $pathText = if ($line.Length -gt 3) { $line.Substring(3).Trim() } else { "" }
    if (-not $pathText) {
      continue
    }

    if ($pathText.Contains(" -> ")) {
      $pathText = ($pathText -split " -> ", 2)[1].Trim()
    }

    $normalizedPath = $pathText.Replace("\", "/")
    foreach ($prefix in $relevantPrefixes) {
      if ($normalizedPath -eq $prefix -or $normalizedPath.StartsWith($prefix)) {
        $dirtyPaths += $normalizedPath
        break
      }
    }
  }

  return @($dirtyPaths | Select-Object -Unique)
}

function Assert-SafeGitState {
  param(
    [string]$RepositoryRoot
  )

  $branchName = (Invoke-Git -RepositoryRoot $RepositoryRoot -Arguments @("rev-parse", "--abbrev-ref", "HEAD") | Select-Object -First 1).Trim()
  if ($branchName -ne "main") {
    throw "Refusing to deploy from git branch '$branchName'. Switch to 'main' or use -AllowUnsafeGit to override."
  }

  $dirtyPaths = Test-RelevantDirtyPaths -RepositoryRoot $RepositoryRoot
  if ($dirtyPaths.Count -gt 0) {
    $pathList = $dirtyPaths -join ", "
    throw "Refusing to deploy with uncommitted changes in tracked project files: $pathList. Commit or stash them first, or use -AllowUnsafeGit to override."
  }
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

function Get-CloudAccessToken {
  param(
    [string]$ClientId,
    [string]$ClientSecret
  )

  $body = @{
    grant_type = "client_credentials"
    client_id = $ClientId
    client_secret = $ClientSecret
    audience = "https://api2.arduino.cc/iot"
  }

  $response = Invoke-RestMethod -Method Post -Uri "https://api2.arduino.cc/iot/v1/clients/token" -ContentType "application/x-www-form-urlencoded" -Body $body
  return $response.access_token
}

function Get-ApiHeadersForScope {
  param(
    [string]$ScopeName,
    [hashtable]$EnvConfig
  )

  if ($ScopeName -eq "cloudspace" -or $ScopeName -eq "university") {
    $clientId = $EnvConfig["ARDUINO_UNI_CLIENT_ID"]
    $clientSecret = $EnvConfig["ARDUINO_UNI_CLIENT_SECRET"]
    $organizationId = $EnvConfig["ARDUINO_UNI_ORG_ID"]
  } else {
    $clientId = $EnvConfig["ARDUINO_CLIENT_ID"]
    $clientSecret = $EnvConfig["ARDUINO_CLIENT_SECRET"]
    $organizationId = $null
  }

  if (-not $clientId -or -not $clientSecret) {
    throw "Missing Arduino Cloud credentials for scope '$ScopeName'."
  }

  $token = Get-CloudAccessToken -ClientId $clientId -ClientSecret $clientSecret
  $headers = @{
    Authorization = "Bearer $token"
    Accept = "application/json"
  }

  if ($organizationId) {
    $headers["X-Organization"] = $organizationId
  }

  return $headers
}

function Read-SketchVersion {
  param([string]$SketchPath)

  $content = Get-Content -LiteralPath $SketchPath -Raw
  $patterns = @(
    'const\s+char\s+FIRMWARE_VERSION\[\]\s*=\s*"([^"]+)"',
    '#define\s+FIRMWARE_VERSION\s+"([^"]+)"',
    'constexpr\s+char\s+FIRMWARE_VERSION\[\]\s*=\s*"([^"]+)"'
  )

  foreach ($pattern in $patterns) {
    $match = [regex]::Match($content, $pattern)
    if ($match.Success) {
      return $match.Groups[1].Value.Trim()
    }
  }

  return $null
}

function Compare-VersionString {
  param(
    [string]$Left,
    [string]$Right
  )

  if ($Left -eq $Right) {
    return 0
  }

  $leftParts = @(($Left -split '\.') | ForEach-Object {
    if ($_ -match '^\d+$') { [int]$_ } else { $_ }
  })
  $rightParts = @(($Right -split '\.') | ForEach-Object {
    if ($_ -match '^\d+$') { [int]$_ } else { $_ }
  })

  $length = [Math]::Max($leftParts.Count, $rightParts.Count)
  for ($index = 0; $index -lt $length; $index++) {
    $leftValue = if ($index -lt $leftParts.Count) { $leftParts[$index] } else { 0 }
    $rightValue = if ($index -lt $rightParts.Count) { $rightParts[$index] } else { 0 }

    if ($leftValue -is [int] -and $rightValue -is [int]) {
      if ($leftValue -lt $rightValue) { return -1 }
      if ($leftValue -gt $rightValue) { return 1 }
    } else {
      $comparison = [string]::CompareOrdinal([string]$leftValue, [string]$rightValue)
      if ($comparison -lt 0) { return -1 }
      if ($comparison -gt 0) { return 1 }
    }
  }

  return 0
}

function Get-ReportedVersionsByThingId {
  param(
    [array]$Devices,
    [object]$Fleet,
    [hashtable]$EnvConfig
  )

  $versionsByThingId = @{}
  $scopes = @($Devices | Select-Object -ExpandProperty scope -Unique)

  foreach ($scopeName in $scopes) {
    $headers = Get-ApiHeadersForScope -ScopeName $scopeName -EnvConfig $EnvConfig
    $things = Invoke-RestMethod -Method Get -Uri "https://api2.arduino.cc/iot/v2/things?show_properties=true" -Headers $headers

    foreach ($thing in $things) {
      $matchingDevice = $Devices | Where-Object { $_.thingId -eq $thing.id } | Select-Object -First 1
      if (-not $matchingDevice) {
        continue
      }

      $versionProperty = $thing.properties | Where-Object {
        $name = if ($null -ne $_.variable_name -and [string]$_.variable_name -ne "") {
          [string]$_.variable_name
        } else {
          [string]$_.name
        }
        $Fleet.versionPropertyNames -contains $name
      } | Select-Object -First 1

      if ($versionProperty) {
        $versionsByThingId[$thing.id] = [string]$versionProperty.last_value
      }
    }
  }

  return $versionsByThingId
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

if (-not $AllowUnsafeGit) {
  Assert-SafeGitState -RepositoryRoot $projectRoot
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

$localSketchVersion = Read-SketchVersion -SketchPath $sharedSketchPath
if (-not $localSketchVersion) {
  throw "Could not read FIRMWARE_VERSION from $sharedSketchPath"
}

$reportedVersionsByThingId = Get-ReportedVersionsByThingId -Devices $devices -Fleet $fleet -EnvConfig $envConfig

foreach ($device in $devices) {
  $reportedVersion = $reportedVersionsByThingId[[string]$device.thingId]
  if (-not $reportedVersion) {
    continue
  }

  if ((Compare-VersionString -Left $reportedVersion -Right $localSketchVersion) -gt 0) {
    throw "Refusing to deploy $($device.name): device reports newer version '$reportedVersion' than local sketch '$localSketchVersion'. Pull the latest changes before deploying."
  }
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
