// Synthetic schema for combining required rules with API formats and union repeaters.
// API behavior is covered separately by required-write-values.json.
export function requiredCombinations() {
  const schema = {
    apiFields: [
      { fieldId: 'title', kind: 'text', required: true },
      { fieldId: 'summary', kind: 'text', required: false },
      { fieldId: 'details', kind: 'custom', customFieldId: 'section' },
      {
        fieldId: 'blocks',
        kind: 'repeater',
        customFieldIds: ['section', 'text'],
        required: true,
      },
    ],
    customFields: [
      {
        fieldId: 'section',
        fields: [
          { fieldId: 'heading', kind: 'text', required: true },
          {
            fieldId: 'groups',
            kind: 'repeater',
            customFieldIds: ['group', 'text'],
            required: true,
            repeaterCountLimitValidation: { repeatCount: { min: 1 } },
          },
        ],
      },
      {
        fieldId: 'group',
        fields: [
          { fieldId: 'enabled', kind: 'boolean', required: true },
          {
            fieldId: 'items',
            kind: 'repeater',
            customFieldIds: ['text', 'link'],
            required: true,
          },
        ],
      },
      {
        fieldId: 'text',
        fields: [
          { fieldId: 'body', kind: 'text', required: true },
          { fieldId: 'note', kind: 'text' },
        ],
      },
      {
        fieldId: 'link',
        fields: [
          { fieldId: 'label', kind: 'text', required: true },
          {
            fieldId: 'target',
            kind: 'relation',
            referencedApiEndpoint: 'pages',
            required: true,
          },
          {
            fieldId: 'targets',
            kind: 'relationList',
            referencedApiEndpoint: 'pages',
            required: true,
          },
          {
            fieldId: 'tags',
            kind: 'select',
            selectItems: [{ value: 'one' }, { value: 'two' }],
            required: true,
          },
        ],
      },
    ],
  };
  return {
    apis: [
      { endpoint: 'pages', type: 'list' },
      { endpoint: 'settings', type: 'object' },
    ],
    schemas: new Map([
      ['pages', schema],
      ['settings', schema],
    ]),
  };
}
