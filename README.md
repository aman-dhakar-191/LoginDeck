# LoginDeck

LoginDeck is a Windows desktop session manager plus a companion Salesforce browser extension.

## Desktop app

LoginDeck supports two browser profile modes:

- **Personal Edge profile** opens Salesforce through the Windows Microsoft Edge protocol handler. Edge uses its normal profile selection and handles existing sign-ins, cookies and saved passwords. LoginDeck does not read, export, copy or store browser credentials. The Edge profile that opens is controlled by Edge/Windows (typically the default or last-used Edge profile).
- **LoginDeck isolated profile** launches Chrome or Edge with a dedicated user-data directory for that saved session. Cookies and site storage are separate for each LoginDeck session; sign in once in each isolated profile.

Personal Edge mode is currently Windows-only and supports Microsoft Edge. It opens a tab/window in Edge but does not give LoginDeck control over that personal browser window. Deleting a Personal Edge session removes only its LoginDeck shortcut/configuration; it does not touch Edge data. Existing sessions without a `profileMode` setting continue to launch as isolated profiles.

Download the Windows installer from the GitHub Releases page.

## Companion extension (early preview)

The unpacked Manifest V3 extension is in the `extension/` folder.

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked and select the repository's extension folder.
4. Open a Salesforce org tab, then click the LoginDeck extension icon to open its side panel.
5. Search by user name, username or email.
6. Choose Open Login As in Setup, then use Salesforce's standard Login action on the user page.

The extension uses the currently signed-in Salesforce page to query the REST API. It does not collect or export session cookies. User search requires Salesforce API access and appropriate visibility/permissions.

## Current integration boundary

The extension's user search and Setup navigation are an early preview. It does not yet hand the selected user into a separate LoginDeck browser profile. The Salesforce Login action opened in Setup will operate in the browser profile where the extension is installed. A secure extension-to-desktop handoff remains a follow-up milestone.

## Releases

Every push to main builds a Windows x64 installer and stores it as a short-lived Actions artifact.

To publish a GitHub Release, open Actions → Build and Release LoginDeck → Run workflow, choose Major, Minor or Patch, optionally enter release notes, and run it. The workflow increments the latest semantic version tag, builds the installer and publishes the EXE.
