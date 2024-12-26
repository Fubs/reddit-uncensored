#!/bin/bash

# Function to find project root
find_project_root() {
    local current_dir="$PWD"
    
    # check if we're already in the project root
    if [ -f "package.json" ] && [ -d "firefox" ] && [ -d "chrome" ]; then
        echo "$current_dir"
        return 0
    fi
    
    # check if we're in dev_scripts directory
    if [ -f "../package.json" ] && [ -d "../firefox" ] && [ -d "../chrome" ]; then
        echo "$(cd .. && pwd)"
        return 0
    fi
    
    echo "Error: Cannot find project root directory" >&2
    return 1
}

# validate required files exist
validate_files() {
    local required_files=(
        "package.json"
        "firefox/package.json"
        "firefox/manifest.json"
        "chrome/package.json"
        "chrome/manifest.json"
    )
    
    local missing_files=()
    
    for file in "${required_files[@]}"; do
        if [ ! -f "$file" ]; then
            missing_files+=("$file")
        fi
    done
    
    if [ ${#missing_files[@]} -ne 0 ]; then
        echo "Error: Missing required files:" >&2
        printf '%s\n' "${missing_files[@]}" >&2
        return 1
    fi
    
    return 0
}

increment_version() {
    local version=$1
    local type=$2
    local major minor patch
    
    IFS='.' read -r major minor patch <<< "$version"
    
    case $type in
        major)
            major=$((major + 1))
            minor=0
            patch=0
            ;;
        minor)
            minor=$((minor + 1))
            patch=0
            ;;
        patch)
            patch=$((patch + 1))
            ;;
        *)
            echo "Invalid version type" >&2
            exit 1
            ;;
    esac
    
    echo "$major.$minor.$patch"
}

# bump patch version by default
VERSION_TYPE="patch"

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --major) VERSION_TYPE="major" ;;
        --minor) VERSION_TYPE="minor" ;;
        --patch) VERSION_TYPE="patch" ;;
        *) echo "Unknown parameter: $1" >&2; exit 1 ;;
    esac
    shift
done

PROJECT_ROOT=$(find_project_root) || exit 1
cd "$PROJECT_ROOT" || exit 1
validate_files || exit 1

current_version=$(jq -r '.version' package.json)
new_version=$(increment_version "$current_version" "$VERSION_TYPE")

files=(
    "package.json"
    "firefox/package.json"
    "firefox/manifest.json"
    "chrome/package.json"
    "chrome/manifest.json"
)

for file in "${files[@]}"; do
    tmp_file="${file}.tmp"
    jq --arg new_ver "$new_version" '.version = $new_ver' "$file" > "$tmp_file"
    mv "$tmp_file" "$file"
    echo "Updated version in $file to $new_version"
done

echo "Version bump complete: $current_version → $new_version ($VERSION_TYPE)"
