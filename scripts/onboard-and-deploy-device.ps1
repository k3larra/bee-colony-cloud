param(
  [Parameter(Mandatory = $true)]
  [string]$Class,

  [Parameter(Mandatory = $true)]
  [string]$DeviceId,

  [string]$Name,

  [string]$Scope = "cloudspace",

  [Parameter(Mandatory = $true)]
  [string]$ExportZip,

  [Parameter(Mandatory = $true)]
  [string]$SecretKeyPdf,

  [string]$ThingId,

  [string]$Fqbn,

  [string]$WifiSsid,

  [string]$WifiPass,

  [string]$Notes = "",

  [switch]$NoWait
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$addScript = Join-Path $PSScriptRoot "add-managed-device.ps1"
$deployScript = Join-Path $PSScriptRoot "deploy-class.ps1"

$addArgs = @(
  "-ExecutionPolicy", "Bypass",
  "-File", $addScript,
  "-Class", $Class,
  "-DeviceId", $DeviceId,
  "-Scope", $Scope,
  "-ExportZip", $ExportZip,
  "-SecretKeyPdf", $SecretKeyPdf
)

if ($Name) { $addArgs += @("-Name", $Name) }
if ($ThingId) { $addArgs += @("-ThingId", $ThingId) }
if ($Fqbn) { $addArgs += @("-Fqbn", $Fqbn) }
if ($WifiSsid) { $addArgs += @("-WifiSsid", $WifiSsid) }
if ($WifiPass) { $addArgs += @("-WifiPass", $WifiPass) }
if ($Notes) { $addArgs += @("-Notes", $Notes) }

$addOutput = & powershell @addArgs
$addResult = $addOutput | ConvertFrom-Json
$deviceName = $addResult.added.name

Write-Host "Onboarded $deviceName. Starting deployment..."

$deployArgs = @(
  "-ExecutionPolicy", "Bypass",
  "-File", $deployScript,
  "-Class", $Class,
  "-DeviceNames", $deviceName
)

if ($NoWait) {
  $deployArgs += "-NoWait"
}

$deployOutput = & powershell @deployArgs
$deployResult = $deployOutput | ConvertFrom-Json

[PSCustomObject]@{
  added = $addResult.added
  thingName = $addResult.thingName
  deviceConfigPath = $addResult.deviceConfigPath
  deploy = $deployResult
} | ConvertTo-Json -Depth 10
