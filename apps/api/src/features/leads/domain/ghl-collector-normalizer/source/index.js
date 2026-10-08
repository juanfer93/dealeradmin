/**
 * Maintainable source manifest for the GHL Custom Code normalizer.
 *
 * The files in ./modules are concatenated in dependency order by
 * ../build-entrypoint.mjs. They intentionally use the Custom Code runtime's
 * inputData variable and do not import Node or application services.
 */
export const GHL_COLLECTOR_NORMALIZER_MODULES = [
  'modules/01-runtime-text.js',
  'modules/02-contact-memory.js',
  'modules/03-vehicle.js',
  'modules/04-contact-flow.js',
  'modules/05-qualification-pipeline.js',
];
