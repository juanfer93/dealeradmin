import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const server = createServer(async (_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(await readFile(new URL('../../apps/web/public/qa-marie-flanagan.html', import.meta.url)));
});
server.listen(3018, '127.0.0.1');
