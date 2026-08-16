#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
project_file="$script_dir/HttpInspector.Adapter.csproj"
adapter_manifest="$script_dir/../adapter.json"
output_directory="$script_dir/bundle"
feed_directory="$output_directory/nuget-feed"
package_version="$(sed -n 's:.*<Version>\([^<]*\)</Version>.*:\1:p' "$project_file" | sed -n '1p')"
expected_package_digest="$(sed -n 's|.*"sha256": "\([^"]*\)".*|\1|p' "$adapter_manifest" | sed -n '1p')"
package_file="$feed_directory/HttpInspector.Adapter.$package_version.nupkg"
package_digest_file="$package_file.sha256"
pack_directory="$(mktemp -d "${TMPDIR:-/tmp}/http-inspector-adapter-pack.XXXXXX")"
pack_feed="$pack_directory/feed"
pack_extract="$pack_directory/extract"
candidate_package="$pack_directory/HttpInspector.Adapter.$package_version.nupkg"

cleanup() {
  rm -rf "$pack_directory"
}
trap cleanup EXIT INT TERM

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    openssl dgst -sha256 "$1" | awk '{print $NF}'
  fi
}

if ! command -v dotnet >/dev/null 2>&1; then
  echo "Error: building the HTTP Inspector distribution requires the .NET SDK so the adapter NuGet package can be prepared." >&2
  exit 1
fi
for command_name in unzip zip; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "Error: $command_name is required to normalize the adapter package." >&2; exit 1; }
done

[[ -n "$package_version" ]] || { echo "Error: adapter package version is missing." >&2; exit 1; }
[[ -n "$expected_package_digest" ]] || { echo "Error: adapter manifest package digest is missing." >&2; exit 1; }
mkdir -p "$feed_directory" "$pack_feed" "$pack_extract"
dotnet pack "$project_file" --configuration Release --nologo --output "$pack_feed"
packed_package="$pack_feed/HttpInspector.Adapter.$package_version.nupkg"
[[ -f "$packed_package" ]] || { echo "Error: dotnet pack did not create $packed_package" >&2; exit 1; }
unzip -q "$packed_package" -d "$pack_extract"
core_properties=()
while IFS= read -r candidate; do core_properties+=("$candidate"); done < <(find "$pack_extract/package/services/metadata/core-properties" -maxdepth 1 -type f -name '*.psmdcp' -print)
[[ ${#core_properties[@]} -eq 1 ]] || { echo "Error: expected exactly one NuGet core-properties file." >&2; exit 1; }
normalized_core_properties="$pack_extract/package/services/metadata/core-properties/http-inspector-adapter.psmdcp"
mv "${core_properties[0]}" "$normalized_core_properties"
sed -e 's#<lastModifiedBy>.*</lastModifiedBy>#<lastModifiedBy>HTTP Inspector deterministic package</lastModifiedBy>#' "$normalized_core_properties" > "$pack_directory/core-properties.xml"
mv "$pack_directory/core-properties.xml" "$normalized_core_properties"
sed -e 's#Target="/package/services/metadata/core-properties/[^"]*"#Target="/package/services/metadata/core-properties/http-inspector-adapter.psmdcp"#' \
  -e '/relationships\/metadata\/core-properties/s/Id="[^"]*"/Id="R_HTTP_INSPECTOR_CORE_PROPERTIES"/' \
  "$pack_extract/_rels/.rels" > "$pack_directory/relationships.xml"
mv "$pack_directory/relationships.xml" "$pack_extract/_rels/.rels"
nuspec_path="$pack_extract/HttpInspector.Adapter.nuspec"
sed -e 's# commit="[^"]*"# commit="HTTP_INSPECTOR_DETERMINISTIC"#' "$nuspec_path" > "$pack_directory/nuspec.xml"
mv "$pack_directory/nuspec.xml" "$nuspec_path"
find "$pack_extract" -exec touch -t 200001010000 {} +
(
  cd "$pack_extract"
  find . -type f -print | sed 's#^\./##' | LC_ALL=C sort | zip -X -q "$candidate_package" -@
)
nuspec="$(unzip -p "$candidate_package" HttpInspector.Adapter.nuspec)"
grep -Fq '<id>HttpInspector.Adapter</id>' <<< "$nuspec" || { echo "Error: adapter package ID does not match HttpInspector.Adapter." >&2; exit 1; }
grep -Fq "<version>$package_version</version>" <<< "$nuspec" || { echo "Error: adapter package version does not match $package_version." >&2; exit 1; }
package_entries="$pack_directory/package-entries.txt"
unzip -Z1 "$candidate_package" > "$package_entries"
grep -Fxq 'lib/net10.0/HttpInspector.Adapter.dll' "$package_entries" || { echo "Error: adapter package is missing the net10.0 assembly." >&2; exit 1; }

candidate_digest="$(sha256_file "$candidate_package")"
[[ "$candidate_digest" == "$expected_package_digest" ]] || { echo "Error: package bytes do not match the manifest digest. Candidate SHA-256: $candidate_digest" >&2; exit 1; }
if [[ -f "$package_file" ]]; then
  existing_entries="$pack_directory/existing-package-entries.txt"
  unzip -Z1 "$package_file" > "$existing_entries"
  if grep -Fxq 'package/services/metadata/core-properties/http-inspector-adapter.psmdcp' "$existing_entries"; then
    existing_digest="$(sha256_file "$package_file")"
    [[ "$existing_digest" == "$candidate_digest" ]] || { echo "Error: package bytes changed without a version change. Increment the adapter package version before rebuilding." >&2; exit 1; }
  else
    mv "$candidate_package" "$package_file"
  fi
else
  mv "$candidate_package" "$package_file"
fi
sha256_file "$package_file" > "$package_digest_file"
echo "Prepared bundled adapter package: $package_file"
