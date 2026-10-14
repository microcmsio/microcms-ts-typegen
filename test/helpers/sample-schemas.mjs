export const apis = [
  { endpoint: 'blogs', type: 'list' },
  { endpoint: 'categories', type: 'list' },
];
export const schemas = {
  blogs: {
    apiFields: [
      { fieldId: 'title', kind: 'text' },
      {
        fieldId: 'tags',
        kind: 'select',
        selectItems: [{ value: 'News' }, { value: 'Guide' }],
      },
      {
        fieldId: 'category',
        kind: 'relation',
        referencedApiEndpoint: 'categories',
      },
      { fieldId: 'hero-image', kind: 'media' },
      {
        fieldId: 'blocks',
        kind: 'repeater',
        customFieldIds: ['text-block', 'image-block'],
      },
    ],
    customFields: [
      {
        fieldId: 'text-block',
        fields: [{ fieldId: 'body', kind: 'richEditorV2' }],
      },
      { fieldId: 'image-block', fields: [{ fieldId: 'image', kind: 'media' }] },
    ],
  },
  categories: {
    apiFields: [{ fieldId: 'name', kind: 'text' }],
    customFields: [],
  },
};
