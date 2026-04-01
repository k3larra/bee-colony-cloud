param(
  [Parameter(Mandatory = $true)]
  [string]$Class,

  [string]$Name,

  [Parameter(Mandatory = $true)]
  [string]$DeviceId,

  [string]$ThingId,

  [string]$Fqbn,

  [string]$Scope = "university",

  [string]$ExportZip,

  [string]$SecretKeyPdf,

  [string]$WifiSsid,

  [string]$WifiPass,

  [string]$Notes = ""
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

function Ensure-Directory {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Read-PdfText {
  param([string]$PdfPath)

  if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw "Python is required to extract text from PDF."
  }

  $pythonCode = @'
from pypdf import PdfReader
import sys

reader = PdfReader(sys.argv[1])
text = "\n".join((page.extract_text() or "") for page in reader.pages)
print(text)
'@

  $tempScript = [System.IO.Path]::GetTempFileName() + ".py"

  try {
    Set-Content -LiteralPath $tempScript -Value $pythonCode
    return (& python $tempScript $PdfPath)
  } finally {
    if (Test-Path -LiteralPath $tempScript) {
      Remove-Item -LiteralPath $tempScript -Force
    }
  }
}

function Get-ClassPrefix {
  param([string]$ClassName)

  switch ($ClassName.ToLowerInvariant()) {
    "worker" { return "W" }
    "drone" { return "D" }
    "queen" { return "Q" }
    "hive" { return "H" }
    default { return $ClassName.Substring(0, 1).ToUpperInvariant() }
  }
}

function Get-NextDeviceName {
  param(
    [object]$Fleet,
    [string]$ClassName
  )

  $prefix = Get-ClassPrefix -ClassName $ClassName
  $pattern = '^' + [regex]::Escape($prefix) + '(\d+)$'
  $numbers = @()

  foreach ($device in $Fleet.devices) {
    if ($device.class -ne $ClassName) {
      continue
    }

    $match = [regex]::Match([string]$device.name, $pattern)
    if ($match.Success) {
      $numbers += [int]$match.Groups[1].Value
    }
  }

  $nextNumber = if ($numbers.Count -gt 0) { ($numbers | Measure-Object -Maximum).Maximum + 1 } else { 1 }
  return "$prefix$nextNumber"
}

function Invoke-CloudApi {
  param(
    [string]$Method,
    [string]$Uri,
    [hashtable]$Headers
  )

  return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $Headers
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

function Get-ThingForDevice {
  param(
    [string]$DeviceId,
    [string]$ScopeName,
    [hashtable]$EnvConfig
  )

  if ($ScopeName -eq "university") {
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

  $things = Invoke-CloudApi -Method Get -Uri "https://api2.arduino.cc/iot/v2/things?show_properties=true" -Headers $headers
  return $things | Where-Object { $_.device_id -eq $DeviceId } | Select-Object -First 1
}

function Copy-DeviceTemplateFiles {
  param(
    [string]$ProjectRoot,
    [string]$ClassName,
    [string]$DeviceName,
    [string]$ExportZipPath
  )

  $deviceRoot = Join-Path $ProjectRoot ("secure\device-configs\" + $DeviceName)
  Ensure-Directory -Path $deviceRoot

  if ($ExportZipPath) {
    $tempRoot = Join-Path $ProjectRoot ("private\onboarding\" + $DeviceName)
    if (Test-Path -LiteralPath $tempRoot) {
      Remove-Item -Recurse -Force -LiteralPath $tempRoot
    }
    Ensure-Directory -Path $tempRoot
    Expand-Archive -LiteralPath $ExportZipPath -DestinationPath $tempRoot -Force

    $thingProperties = Get-ChildItem -LiteralPath $tempRoot -Recurse -Filter "thingProperties.h" | Select-Object -First 1
    $secrets = Get-ChildItem -LiteralPath $tempRoot -Recurse -Filter "arduino_secrets.h" | Select-Object -First 1

    if (-not $thingProperties -or -not $secrets) {
      throw "The export zip did not contain thingProperties.h and arduino_secrets.h."
    }

    Copy-Item -LiteralPath $thingProperties.FullName -Destination (Join-Path $deviceRoot "thingProperties.h") -Force
    Copy-Item -LiteralPath $secrets.FullName -Destination (Join-Path $deviceRoot "arduino_secrets.h") -Force
    return
  }

  $classSketchRoot = Join-Path $ProjectRoot ("sketches\" + $ClassName)
  $thingTemplate = Join-Path $classSketchRoot "thingProperties.h.example"
  $secretTemplate = Join-Path $classSketchRoot "arduino_secrets.h.example"

  if (Test-Path -LiteralPath $thingTemplate) {
    Copy-Item -LiteralPath $thingTemplate -Destination (Join-Path $deviceRoot "thingProperties.h") -Force
  }
  if (Test-Path -LiteralPath $secretTemplate) {
    Copy-Item -LiteralPath $secretTemplate -Destination (Join-Path $deviceRoot "arduino_secrets.h") -Force
  }
}

function Get-SecretKeyFromPdf {
  param([string]$PdfPath)

  $text = Read-PdfText -PdfPath $PdfPath
  $match = [regex]::Match($text, "Client Secret\s+([^\s]+)")
  if (-not $match.Success) {
    throw "Could not extract Client Secret from PDF: $PdfPath"
  }
  return $match.Groups[1].Value.Trim()
}

function Find-SecretKeyPdfForDevice {
  param(
    [string]$ProjectRoot,
    [string]$DeviceId
  )

  $candidates = @()
  $secretFolder = Join-Path $ProjectRoot "secure\device-secrets"
  if (Test-Path -LiteralPath $secretFolder) {
    $candidates += Get-ChildItem -LiteralPath $secretFolder -Filter *.pdf -File -ErrorAction SilentlyContinue
  }

  $legacyFolder = Join-Path $ProjectRoot "secure"
  $candidates += Get-ChildItem -LiteralPath $legacyFolder -Filter *.pdf -File -ErrorAction SilentlyContinue

  foreach ($candidate in $candidates) {
    $text = Read-PdfText -PdfPath $candidate.FullName
    if ($text -match [regex]::Escape($DeviceId)) {
      return $candidate.FullName
    }
  }

  return $null
}

function Update-SecretDefine {
  param(
    [string]$Path,
    [string]$Key,
    [string]$Value
  )

  $content = Get-Content -LiteralPath $Path -Raw
  $pattern = '#define\s+' + [regex]::Escape($Key) + '\s+"[^"]*"'
  $replacement = '#define ' + $Key + ' "' + $Value + '"'

  if ($content -match $pattern) {
    $updated = [regex]::Replace($content, $pattern, $replacement)
  } else {
    $updated = $content.TrimEnd() + [Environment]::NewLine + $replacement + [Environment]::NewLine
  }

  Set-Content -LiteralPath $Path -Value $updated
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$fleetConfigPath = Join-Path $projectRoot "config\fleet.json"
$localEnvPath = Join-Path $projectRoot "secure\local.env"

if (-not (Test-Path -LiteralPath $fleetConfigPath)) {
  throw "Missing fleet config: $fleetConfigPath"
}
if (-not (Test-Path -LiteralPath $localEnvPath)) {
  throw "Missing local env: $localEnvPath"
}

$fleet = Get-Content -LiteralPath $fleetConfigPath -Raw | ConvertFrom-Json
$envConfig = Read-KeyValueFile -Path $localEnvPath

if (-not $fleet.classes.$Class) {
  throw "Unknown class '$Class'."
}

$thing = $null
if (-not $ThingId -or -not $Fqbn) {
  $thing = Get-ThingForDevice -DeviceId $DeviceId -ScopeName $Scope -EnvConfig $envConfig
  if (-not $thing) {
    throw "Could not find a Cloud Thing bound to device ID '$DeviceId' in scope '$Scope'."
  }
}

if (-not $Name) {
  if ($thing -and $thing.device_name) {
    $Name = [string]$thing.device_name
  } else {
    $Name = Get-NextDeviceName -Fleet $fleet -ClassName $Class
  }
}

if (($fleet.devices | Where-Object { $_.name -eq $Name }).Count -gt 0) {
  if ($thing -and $thing.device_name -eq $Name) {
    $Name = Get-NextDeviceName -Fleet $fleet -ClassName $Class
  } else {
    throw "A device named '$Name' already exists in config/fleet.json."
  }
}

if (($fleet.devices | Where-Object { $_.deviceId -eq $DeviceId }).Count -gt 0) {
  throw "Device ID '$DeviceId' already exists in config/fleet.json."
}

if (-not $ThingId) {
  $ThingId = $thing.id
}

if (-not $Fqbn) {
  if ($thing.device_fqbn) {
    $Fqbn = $thing.device_fqbn
  } else {
    $sameClassDevice = $fleet.devices | Where-Object { $_.class -eq $Class -and $_.fqbn } | Select-Object -First 1
    if ($sameClassDevice) {
      $Fqbn = $sameClassDevice.fqbn
    } else {
      throw "Could not infer FQBN. Pass -Fqbn explicitly."
    }
  }
}

Copy-DeviceTemplateFiles -ProjectRoot $projectRoot -ClassName $Class -DeviceName $Name -ExportZipPath $ExportZip

$deviceConfigRoot = Join-Path $projectRoot ("secure\device-configs\" + $Name)
$secretHeaderPath = Join-Path $deviceConfigRoot "arduino_secrets.h"

if (-not $WifiSsid) {
  $WifiSsid = $envConfig["DEFAULT_WIFI_SSID"]
}
if (-not $WifiPass) {
  $WifiPass = $envConfig["DEFAULT_WIFI_PASS"]
}

if (-not $SecretKeyPdf) {
  $SecretKeyPdf = Find-SecretKeyPdfForDevice -ProjectRoot $projectRoot -DeviceId $DeviceId
}

if ($SecretKeyPdf) {
  $deviceSecret = Get-SecretKeyFromPdf -PdfPath $SecretKeyPdf
  Update-SecretDefine -Path $secretHeaderPath -Key "SECRET_DEVICE_KEY" -Value $deviceSecret
}

if ($WifiSsid) {
  Update-SecretDefine -Path $secretHeaderPath -Key "SECRET_SSID" -Value $WifiSsid
}

if ($WifiPass) {
  Update-SecretDefine -Path $secretHeaderPath -Key "SECRET_OPTIONAL_PASS" -Value $WifiPass
}

$newDevice = [PSCustomObject]@{
  name = $Name
  deviceId = $DeviceId
  thingId = $ThingId
  class = $Class
  fqbn = $Fqbn
  enabled = $true
  scope = $Scope
  notes = $Notes
}

$updatedDevices = @($fleet.devices) + $newDevice
$updatedFleet = [PSCustomObject]@{
  classes = $fleet.classes
  versionPropertyNames = $fleet.versionPropertyNames
  devices = $updatedDevices
}

$updatedFleet | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $fleetConfigPath

[PSCustomObject]@{
  added = $newDevice
  thingName = if ($thing) { $thing.name } else { $null }
  deviceConfigPath = $deviceConfigRoot
  secretKeyPdf = $SecretKeyPdf
  nextStep = if ($ExportZip -and ($SecretKeyPdf -or $WifiSsid -or $WifiPass)) {
    "Review secure/device-configs/$Name and deploy the class."
  } elseif ($ExportZip) {
    "Fill in real secrets in arduino_secrets.h if Arduino Cloud redacted them, then deploy the class."
  } else {
    "Replace the scaffolded thingProperties.h and arduino_secrets.h with the device export from Arduino Cloud."
  }
} | ConvertTo-Json -Depth 10
