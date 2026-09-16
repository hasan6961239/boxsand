#!/usr/bin/env node
/**
 * Maintenance CLI entry point.
 *
 * Deliberately tiny: it sets the environment the commands should run in, then
 * loads them dynamically. A static import would be hoisted above these
 * assignments and config.js would already have read the old values.
 *
 *   node backend/src/cli.js <command> [options]
 */
import { silenceSqliteWarning } from './util/quiet.js';

silenceSqliteWarning();

// A command-line tool should print its own output, not a stream of startup
// log lines. Warnings and errors still come through.
if (!process.env.LOG_LEVEL) process.env.LOG_LEVEL = 'warn';

const { runCli } = await import('./cli-commands.js');
await runCli(process.argv.slice(2));
