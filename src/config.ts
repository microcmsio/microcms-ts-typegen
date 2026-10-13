/** Import path and exported type name for an extension field's data. */
export type ExtensionFieldType = {
  from: string;
  data: string;
};

/** Rules for generated types. Write types always enforce required and minimum-count settings. */
export type TypeRules = {
  /** Trust required and minimum-count settings for reads. An object also enables this rule. Default: false. */
  trustReadFieldConstraints?:
    | boolean
    | {
        /** Trust that referenced content can be retrieved. Default: false. */
        trustReferenceAvailability?: boolean;
      };
};

/** Input settings for one service. Credentials are validated before API requests. */
export type ServiceConfig = {
  serviceDomain: string | undefined;
  apiKey: string | undefined;
  output: string;
  endpoints?: string[];
  extensionFieldTypes?: Record<string, Record<string, ExtensionFieldType>>;
  typeRules?: TypeRules;
};

export type Config = {
  services: Record<string, ServiceConfig>;
};
