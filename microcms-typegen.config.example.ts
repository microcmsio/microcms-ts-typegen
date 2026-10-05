import type { Config } from 'microcms-typegen';

export default {
  services: {
    main: {
      serviceDomain: process.env.MICROCMS_SERVICE_DOMAIN,
      apiKey: process.env.MICROCMS_API_INFO_API_KEY,
      output: './src/microcms-types.ts',
    },
  },
} satisfies Config;
