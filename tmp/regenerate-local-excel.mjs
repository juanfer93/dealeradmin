import fs from 'node:fs/promises';
import { AppDataSource } from '../apps/api/src/database/data-source.ts';
import { ExportReportService } from '../apps/api/src/features/reports/application/export-report.service.ts';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const outputDir = 'C:/dev/dealeradmin/outputs/local-excel-20260903';
const rawPath = `${outputDir}/dealeradmin-local-export-raw.xlsx`;
const outputPath = `${outputDir}/dealerADMIN-leads-all-2026-08-01-to-2026-08-31.xlsx`;
const previewDir = `${outputDir}/previews-phone-normalized`;
const fileName = 'dealerADMIN-leads-all-2026-08-01-to-2026-08-31.xlsx';

await fs.mkdir(outputDir, { recursive: true });
const dataSource = await AppDataSource.initialize();
try {
  const service = new ExportReportService(dataSource);
  const raw = await service.generateXlsx(
    'all',
    new Date('2026-08-01T00:00:00.000Z'),
    new Date('2026-08-31T23:59:59.999Z'),
    fileName,
  );
  await fs.writeFile(rawPath, raw);

  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(rawPath));
  const sheetNames = workbook.worksheets.items.map((sheet) => sheet.name);
  const inspect = await workbook.inspect({ kind: 'workbook,sheet,region', maxChars: 12000, tableMaxRows: 6, tableMaxCols: 8, tableMaxCellChars: 100 });
  console.log(JSON.stringify({ sheetNames, inspect: inspect.ndjson ?? inspect }));

  await fs.mkdir(previewDir, { recursive: true });
  for (const sheetName of sheetNames) {
    const preview = await workbook.render({ sheetName, autoCrop: 'all', scale: 1, format: 'png' });
    const safeName = sheetName.replace(/[^a-zA-Z0-9_-]/g, '-');
    await fs.writeFile(`${previewDir}/${safeName}.png`, new Uint8Array(await preview.arrayBuffer()));
  }

  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(outputPath);
  const history = await dataSource.query(
    `SELECT status, dealer_filter, row_count, sheet_count, file_name
     FROM report_export_history
     WHERE file_name = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [fileName],
  );
  console.log(JSON.stringify({ outputPath, bytes: (await fs.stat(outputPath)).size, history }));
} finally {
  await dataSource.destroy();
}
