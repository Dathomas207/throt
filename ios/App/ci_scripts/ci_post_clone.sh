#!/bin/sh
# Xcode Cloud runs this right after it clones the repo, before it resolves Swift packages.
# node_modules and the built web app are not in git, and the Capacitor plugins' Swift packages
# live inside node_modules, so install them, build the web app and copy it into the iOS project.
set -e
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1
brew install node
cd "$CI_PRIMARY_REPOSITORY_PATH"
npm ci --no-audit --no-fund
npm run build
npx cap sync ios
