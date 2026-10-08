/**
 * Public compatibility facade for the backend collector normalizer.
 *
 * Keep this path stable: webhooks, bulk imports, and existing consumers import
 * the normalizer from here. The implementation lives in the focused modules
 * under ./collector-normalizer.
 */
export * from './collector-normalizer/index';
