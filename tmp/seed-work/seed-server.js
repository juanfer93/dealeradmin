const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const files = new Map([
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/locations.us-2024.csv', ['locations.us-2024.csv', 'text/csv; charset=utf-8']],
]);

http.createServer((req, res) => {
  const entry = files.get(req.url);
  if (!entry) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': entry[1] });
  fs.createReadStream(path.join(root, entry[0])).pipe(res);
}).listen(8765, '127.0.0.1');
