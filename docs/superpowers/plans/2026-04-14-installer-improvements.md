# Plan: Alpha Print Installer Improvements

**Goal:** Add progress details/logs to installer, customize uninstaller with branded pages, answer 32-bit question
**Date:** 2026-04-14

## Architecture

The Alpha Print installer uses electron-builder with NSIS (assisted mode, oneClick: false). The NSIS templates in electron-builder hardcode `ShowInstDetails nevershow` in `common.nsh`. We override this using `customHeader` macro in `installer.nsh` (last directive wins in NSIS). For the uninstaller, we add `customUnWelcomePage` and `customUninstallPage` macros to match the branded installer experience.

## Tech Stack / Key Dependencies

- electron-builder 26.8.1
- NSIS (via electron-builder)
- MUI2 (Modern UI 2 for NSIS)

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| assets/installer.nsh | Modify | Add customHeader macro (ShowInstDetails/ShowUnInstDetails), add uninstaller page macros |
| electron-builder.yml | No change needed | Config is already correct; sidebar images use defaults |

## Task 1: Add ShowInstDetails/ShowUnInstDetails via customHeader

**Files:** assets/installer.nsh

### Analysis

- `common.nsh` (template) sets `ShowInstDetails nevershow` and `ShowUninstDetails nevershow`
- `installer.nsi` includes `common.nsh` at line 8, then checks `customHeader` at lines 45-47
- In NSIS, the LAST `ShowInstDetails` directive wins
- So `customHeader` macro can override with `ShowInstDetails show`

### Steps

1. Add `!macro customHeader` at the TOP of installer.nsh (before other macros)
2. Inside it: `ShowInstDetails show` and `ShowUnInstDetails show`
3. This forces NSIS to show the details/log panel during install AND uninstall

## Task 2: Add Uninstaller Welcome and Finish Pages

**Files:** assets/installer.nsh

### Analysis

- `assistedInstaller.nsh` checks for `customUnWelcomePage` macro (lines 67-71) — if defined, uses it; if not, shows default MUI_UNPAGE_WELCOME
- `assistedInstaller.nsh` checks for `customUninstallPage` macro (line 79) — runs after MUI_UNPAGE_INSTFILES, before MUI_UNPAGE_FINISH
- We need `customUnWelcomePage` for branded welcome text
- The finish page is already shown by default (MUI_UNPAGE_FINISH at line 81)
- For custom finish text, we define the MUI variables before the uninstaller section

### Steps

1. Add `!macro customUnWelcomePage` with branded welcome text in Portuguese
2. Add uninstaller finish page text via MUI defines (similar to installer finish page)

## Task 3: Verify Build

### Steps

1. Run `npm run build` in alpha-print directory
2. Verify installer is generated in `release/` directory

## Notes on 32-bit

No code changes needed. Recommendation for CEO:
- Keep x64 only (current config)
- Less than 1% of Windows PCs are 32-bit
- Electron 36 has poor ia32 support
- Restaurant POS terminals are virtually all 64-bit
- Keeping ia32 doubles installer size (83MB -> 160MB)
- If a specific client needs 32-bit, we can generate a separate build on demand
