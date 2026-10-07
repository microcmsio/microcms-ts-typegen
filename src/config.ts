/** Import path and exported type name for an extension field's data. */
export type ExtensionFieldType = {
  from: string;
  data: string;
};

/** Input settings for one service. Credentials are validated before API requests. */
export type ServiceConfig = {
  serviceDomain: string | undefined;
  apiKey: string | undefined;
  output: string;
  endpoints?: string[];
  extensionFieldTypes?: Record<string, Record<string, ExtensionFieldType>>;
};

export type Config = {
  services: Record<string, ServiceConfig>;
};
