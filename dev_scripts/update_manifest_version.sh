#!/bin/bash

# Function to find project root
find_project_root() {
    local current_dir="$PWD"
    
    if [ -d "firefox" ] && [ -d "chrome" ]; then
        echo "$current_dir"
        return 0
    fi
    
    if [ -d "../firefox" ] && [ -d "../chrome" ]; then
        echo "$(cd .. && pwd)"
        return 0
    fi
    
    echo "Error: Cannot find project root directory" >&2
    return 1
}

# validate required files exist
validate_files() {
    local required_files=(
        "firefox/dist/manifest.json"
        "chrome/dist/manifest.json"
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

PROJECT_ROOT=$(find_project_root) || exit 1
cd "$PROJECT_ROOT" || exit 1
validate_files || exit 1

files=(
    "firefox/dist/manifest.json"
    "chrome/dist/manifest.json"
)

for file in "${files[@]}"; do
    tmp_file="${file}.tmp"
    jq --arg new_ver "$1" '.version = $new_ver' "$file" > "$tmp_file"
    mv "$tmp_file" "$file"
    echo "Updated version in $file to $1"
done

echo "manifest.json version set to $1"
