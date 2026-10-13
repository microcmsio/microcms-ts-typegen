/** Narrow values received from a config module or an API response. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

/** Validate and normalize config input before requests and direct generation. */
export function validateTypeRules(typeRules: unknown): {
  trustReadFieldConstraints: boolean;
  trustReferenceAvailability: boolean;
} {
  const rules = {
    trustReadFieldConstraints: false,
    trustReferenceAvailability: false,
  };
  if (typeRules === undefined) return rules;
  if (!isRecord(typeRules)) throw new Error('typeRules must be an object');
  for (const key of Object.keys(typeRules)) {
    if (key !== 'trustReadFieldConstraints')
      throw new Error(`Unknown typeRules option ${key}`);
  }
  const value = typeRules.trustReadFieldConstraints;
  if (value === undefined) return rules;
  if (typeof value === 'boolean') {
    rules.trustReadFieldConstraints = value;
    return rules;
  }
  if (!isRecord(value))
    throw new Error(
      'typeRules.trustReadFieldConstraints must be a boolean or an object',
    );
  for (const key of Object.keys(value)) {
    if (key !== 'trustReferenceAvailability')
      throw new Error(
        `Unknown typeRules.trustReadFieldConstraints option ${key}`,
      );
  }
  const reference = value.trustReferenceAvailability;
  if (reference !== undefined && typeof reference !== 'boolean')
    throw new Error(
      'typeRules.trustReadFieldConstraints.trustReferenceAvailability must be a boolean',
    );
  rules.trustReadFieldConstraints = true;
  rules.trustReferenceAvailability = reference ?? false;
  return rules;
}
