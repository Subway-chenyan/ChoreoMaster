function Assert-ExactProductVersion {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$ActualVersion,
    [Parameter(Mandatory = $true)][string]$ExpectedVersion
  )

  if ($ExpectedVersion -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') {
    throw "ExpectedVersion must be a strict x.y.z version: $ExpectedVersion"
  }
  if (-not [string]::Equals(
    $ActualVersion,
    $ExpectedVersion,
    [StringComparison]::Ordinal
  )) {
    throw "Installer product version $ActualVersion does not match $ExpectedVersion"
  }
}

function Assert-ExactPublisherName {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$ActualPublisher,
    [Parameter(Mandatory = $true)][string]$ExpectedPublisher
  )

  if ([string]::IsNullOrWhiteSpace($ExpectedPublisher)) {
    throw 'ExpectedPublisher is required for signed production artifacts'
  }
  if (-not [string]::Equals(
    $ActualPublisher,
    $ExpectedPublisher,
    [StringComparison]::OrdinalIgnoreCase
  )) {
    throw "Signer SimpleName $ActualPublisher does not match $ExpectedPublisher"
  }
}
