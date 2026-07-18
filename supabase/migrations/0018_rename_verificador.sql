-- Rename the analyst_default persona's display name from "Analista/Verificador"
-- to "Verificador" to disambiguate it from the unrelated "Analista Científico"
-- persona (they were too visually similar in the UI). Only the `name` column
-- changes; the persona `id` (analyst_default) is unchanged. Idempotent: safe
-- to re-run.

UPDATE public.personalities
SET name = 'Verificador'
WHERE id = 'analyst_default'
  AND name != 'Verificador';
