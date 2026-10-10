import fs from 'node:fs/promises';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = 'C:/dev/dealeradmin/outputs/local-excel-20260903/dealeradmin-local-export.xlsx';
const outputDir = 'C:/dev/dealeradmin/outputs/local-excel-20260903/previews';
await fs.mkdir(outputDir, { recursive: true });

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sheetNames = workbook.worksheets.items.map((sheet) => sheet.name);
const inspect = await workbook.inspect({ kind: 'workbook,sheet,region', maxChars: 12000, tableMaxRows: 6, tableMaxCols: 8, tableMaxCellChars: 100 });
console.log(JSON.stringify({ sheetNames, inspect: inspect.ndjson ?? inspect }));

for (const sheetName of sheetNames) {
  const preview = await workbook.render({ sheetName, autoCrop: 'all', scale: 1, format: 'png' });
  const safeName = sheetName.replace(/[^a-zA-Z0-9_-]/g, '-');
  await fs.writeFile(`${outputDir}/${safeName}.png`, new Uint8Array(await preview.arrayBuffer()));
}
