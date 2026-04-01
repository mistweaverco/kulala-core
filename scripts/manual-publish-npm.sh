#!/usr/bin/env bash

if [ -z "$VERSION" ]; then
  echo "VERSION environment variable is not set. Exiting."
  exit 1
fi

# Install dependencies with bun, ensuring the lockfile is respected
bun install --frozen-lockfile || (echo "Failed to install dependencies, exiting with error code $?" && exit 1)
# Update the version in package.json without creating a git tag
npm --prefix packages/core version "${VERSION}" --no-git-tag-version || (echo "Failed to update package version, exiting with error code $?" && exit 1)
# Build and publish the package
cd packages/core || (echo "Failed to change directory to packages/core, exiting with error code $?" && exit 1)
# Clean the dist directory before building
rm -rf dist/* || (echo "Failed to clean dist directory, exiting with error code $?" && exit 1)
# Build the package
bun run build || (echo "Failed to build package, exiting with error code $?" && exit 1)
# Publish the package to npm with public access
npm publish --access public || (echo "Failed to publish package, exiting with error code $?" && exit 1)
# Reset the version back to 0.0.0 after publishing
npm version "0.0.0" --no-git-tag-version || (echo "Failed to reset package version, exiting with error code $?" && exit 1)
