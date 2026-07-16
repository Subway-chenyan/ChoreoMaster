param(
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [Parameter(Mandatory = $true)][string]$ExpectedVersion,
  [string]$ExpectedPublisher = '',
  [switch]$AllowUnsigned
)

$ErrorActionPreference = 'Stop'
. (Join-Path -Path $PSScriptRoot -ChildPath 'windows-signature-helpers.ps1')

$item = Get-Item -LiteralPath $InstallerPath
$actualVersion = $item.VersionInfo.ProductVersion
Assert-ExactProductVersion -ActualVersion $actualVersion -ExpectedVersion $ExpectedVersion

$signature = Get-AuthenticodeSignature -LiteralPath $InstallerPath
if ($AllowUnsigned -and $signature.Status -eq 'NotSigned') {
  Write-Host 'Unsigned artifact accepted for dry-run only.'
  exit 0
}
if ($signature.Status -ne 'Valid') {
  throw "Authenticode status is $($signature.Status)"
}
$actualPublisher = $signature.SignerCertificate.GetNameInfo(
  [System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName,
  $false
)
Assert-ExactPublisherName `
  -ActualPublisher $actualPublisher `
  -ExpectedPublisher $ExpectedPublisher

Write-Host "Valid signature: $actualPublisher"
