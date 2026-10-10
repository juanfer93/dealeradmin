import fs from 'node:fs/promises';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = 'C:/Users/Dell/OneDrive/Escritorio/Leads/All leads/All dealer leads August.xlsx';
const outputDir = 'C:/dev/dealeradmin/outputs/local-excel-20260903/reference-previews';
await fs.mkdir(outputDir, { recursive: true });

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sheetNames = workbook.worksheets.items.map((sheet) => sheet.name);
const inspect = await workbook.inspect({ kind: 'workbook,sheet,region,computedStyle', maxChars: 20000, tableMaxRows: 8, tableMaxCols: 12, tableMaxCellChars: 120 });
console.log(JSON.stringify({ sheetNames, inspect: inspect.ndjson ?? inspect }));

for (const sheetName of sheetNames) {
  const preview = await workbook.render({ sheetName, autoCrop: 'all', scale: 1, format: 'png' });
  const safeName = sheetName.replace(/[^a-zA-Z0-9_-]/g, '-');
  await fs.writeFile(`${outputDir}/${safeName}.png`, new Uint8Array(await preview.arrayBuffer()));
}
