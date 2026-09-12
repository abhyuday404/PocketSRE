import type { Diagnosis, IncidentBundle } from '@pocketsre/contracts';
import { assessEvidence } from './assessment.js';
import { validateDiagnosis } from './validate.js';

export function createDeterministicDiagnosis(bundle: IncidentBundle): Diagnosis {
  const validation = validateDiagnosis(assessEvidence(bundle).diagnosis, bundle);
  // Fallbacks cross exactly the same boundary as model output, including empty evidence.
  if (!validation.success)
    throw new Error(`Invalid deterministic diagnosis: ${validation.errors.join(' ')}`);
  return validation.diagnosis;
}
