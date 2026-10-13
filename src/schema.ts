/** API metadata used to select endpoints and distinguish list/object formats. */
export type ApiInfo = {
  endpoint: string;
  type: string;
};

/** Field details whose type-specific values are checked by the generator. */
export type SchemaField = {
  fieldId: string;
  kind: string;
  required?: boolean;
  repeaterCountLimitValidation?: unknown;
  relationListCountLimitValidation?: unknown;
  referencedApiEndpoint?: string;
  customFieldId?: string;
  customFieldIds?: unknown;
  selectItems?: unknown;
};

export type CustomField = {
  fieldId: string;
  fields: SchemaField[];
};

export type ApiSchema = {
  apiFields: SchemaField[];
  customFields: CustomField[];
};

export type SchemaClient = {
  listApis(): Promise<ApiInfo[]>;
  getSchema(endpoint: string): Promise<ApiSchema>;
};
