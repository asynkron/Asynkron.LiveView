import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { UnifiedMarkdownServer } from './server.js';

const argv = yargs(hideBin(process.argv))
  .option('path', {
    alias: 'p',
    type: 'string',
    default: 'markdown',
    describe: 'Directory to watch for markdown files',
  })
  .option('port', {
    alias: 'P',
    type: 'number',
    default: 8080,
    describe: 'Port to bind the HTTP server',
  })
  .help()
  .parseSync();

const server = new UnifiedMarkdownServer({
  markdownDir: argv.path,
  port: argv.port,
});
server.start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start Node backend:', error);
  process.exitCode = 1;
});
