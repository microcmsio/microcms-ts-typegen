import { requiredCombinations } from './required-combinations.mjs';

// Required/optional references and minimum counts across cyclic and nested schemas.
export function readReferenceSchemas() {
  const result = requiredCombinations();
  result.schemas.get('pages').apiFields.push(
    {
      fieldId: 'mustRef',
      kind: 'relation',
      referencedApiEndpoint: 'pages',
      required: true,
    },
    { fieldId: 'mayRef', kind: 'relation', referencedApiEndpoint: 'pages' },
    {
      fieldId: 'mustRefs',
      kind: 'relationList',
      referencedApiEndpoint: 'pages',
      required: true,
    },
    {
      fieldId: 'minimumRefs',
      kind: 'relationList',
      referencedApiEndpoint: 'pages',
      relationListCountLimitValidation: { relationListCount: { min: 1 } },
    },
    {
      fieldId: 'mayRefs',
      kind: 'relationList',
      referencedApiEndpoint: 'pages',
    },
    {
      fieldId: 'zeroRefs',
      kind: 'relationList',
      referencedApiEndpoint: 'pages',
      relationListCountLimitValidation: { relationListCount: { min: 0 } },
    },
  );
  return result;
}
