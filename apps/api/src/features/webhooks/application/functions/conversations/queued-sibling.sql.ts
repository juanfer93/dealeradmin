/**
 * Prevents a background selector from fetching a non-terminal row when the
 * same dealer already has a queued row for the same contact or phone.
 */
export function queuedSiblingExclusionSql(currentAlias = 'conversations'): string {
  if (!/^[a-z_]+$/.test(currentAlias)) throw new Error('Invalid SQL alias');
  return `
           AND (
             ${currentAlias}.status = 'queued'
             OR NOT EXISTS (
               SELECT 1
               FROM conversations queued_sibling
               INNER JOIN leads queued_lead ON queued_lead.id = queued_sibling.lead_id
               WHERE queued_sibling.id <> ${currentAlias}.id
                 AND queued_sibling.status = 'queued'
                 AND queued_sibling.ghl_location_id = ${currentAlias}.ghl_location_id
                 AND (
                   queued_sibling.ghl_contact_id = ${currentAlias}.ghl_contact_id
                   OR (
                     NULLIF(queued_lead.canonical_phone, '') IS NOT NULL
                     AND NULLIF((SELECT current_lead.canonical_phone FROM leads current_lead WHERE current_lead.id = ${currentAlias}.lead_id), '') IS NOT NULL
                     AND queued_lead.canonical_phone = (SELECT current_lead.canonical_phone FROM leads current_lead WHERE current_lead.id = ${currentAlias}.lead_id)
                   )
                 )
                 AND NULLIF(queued_sibling.qualification_snapshot->>'assigned_dealer_id', '') IS NOT NULL
                 AND queued_sibling.qualification_snapshot->>'assigned_dealer_id' = ${currentAlias}.qualification_snapshot->>'assigned_dealer_id'
             )
           )`;
}
