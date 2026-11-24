# LoginDeck

LoginDeck is a Windows desktop session manager plus a companion browser extension.

## Desktop app

The desktop app manages persistent, isolated Chrome/Edge profiles. Download the Windows installer from the GitHub Releases page.

## Companion extension (early preview)

The unpacked Manifest V3 extension is in the extension/ folder.

1. Open chrome://extensions or edge://extensions.
2. Enable Developer mode.
3. Choose Load unpacked and select the repository's extension folder.
4. Open a Salesforce org tab, then click the LoginDeck extension icon to open its side panel.
5. Search by user name, username or email.
6. Choose Open Login As in Setup, then use Salesforce's standard Login action on the user page.

The extension uses the currently signed-in Salesforce page to query the REST API. It does not collect or export session cookies. User search requires Salesforce API access and appropriate visibility/permissions.

## Current integration boundary

The extension's user search and Setup navigation are an early preview. It does not yet hand the selected user into a separate LoginDeck browser profile. The Salesforce Login action opened in Setup will operate in the browser profile where the extension is installed. A secure extension-to-desktop handoff is a follow-up milestone; it needs a supported way to perform the admin Login As flow inside the destination isolated profile without exporting browser cookies.

## Releases

Every push to main builds a Windows x64 installer and stores it as a short-lived Actions artifact.

To publish a GitHub Release, open Actions → Build and Release LoginDeck → Run workflow, choose Major, Minor or Patch, optionally enter release notes, and run it. The workflow increments the latest semantic version tag, builds the installer and publishes the EXE.
