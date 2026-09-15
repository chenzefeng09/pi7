========================================================================
 pi for Windows 7 - portable bundle
========================================================================

HOW TO RUN
  Double-click Start-pi.cmd. The bundled ConEmu opens and starts pi.

OFFLINE UPGRADE
  Extract a new release beside the old folder; never overwrite the old folder.
  Run Upgrade-from-old.cmd in the new folder. It migrates portable user data,
  keeps the new Win7-compatible extension versions, and writes an upgrade report.
  See UPGRADE.txt for the complete procedure and rollback instructions.

PORTABLE CONFIGURATION
  Start-pi.cmd sets:

    PI_CODING_AGENT_DIR=<this folder>\config\agent

  This redirects pi to the portable configuration directory. It does not copy
  or overwrite %USERPROFILE%\.pi\agent.

  Configure pi with its native files:

    config\agent\auth.json       provider credentials
    config\agent\settings.json   default provider, model, and UI settings
    config\agent\models.json     custom providers and models
    config\agent\mcp.json        MCP servers

  You can also use /login and /settings inside pi. There is no config.txt
  compatibility layer and no generated model configuration.

FOLDER LAYOUT
  Start-pi.cmd  double-click launcher
  node\         portable Node 16.20.2
  app\          pi and runtime dependencies
  conemu\       portable ConEmu
  fonts\        symbol font registered for the current login session
  config\       portable pi settings, credentials, extensions, and sessions
  tools\        pi.cmd and helper scripts

REQUIREMENTS
  Windows 7 SP1 x64 and network access to the configured model provider.

KNOWN LIMITATIONS
  16 ANSI colors, no italic text, Shift+Tab behaves like Tab, and minor repaint
  flicker during streaming. These are Windows 7 console limitations.
========================================================================
