#!/usr/bin/env node
/**
 * Windows 7 / Node 16 entry point.
 *
 * Installs the Node 16 runtime polyfills first, then defers to the normal CLI.
 * Ship `dist/` + `node_modules/` to the Win7 machine and launch with:
 *   node dist/cli.win7.js [args...]
 * (or use the generated pi-win7.cmd launcher). Use ConEmu as the terminal so
 * ANSI/VT escape sequences render — the stock Win7 console does not interpret them.
 */
import "./polyfills-node16.ts";
import "./cli.ts";
