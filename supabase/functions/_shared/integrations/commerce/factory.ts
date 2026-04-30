import type { CommerceProvider } from './types.ts';
import { ShopifyProvider } from './shopify-provider.ts';

export interface ShopIntegrationConfig {
  provider_type: 'shopify' | 'woocommerce' | 'bigcommerce';
  shop_domain: string;
  access_token: string;
  api_version?: string;
}

export function createCommerceProvider(config: ShopIntegrationConfig): CommerceProvider {
  switch (config.provider_type) {
    case 'shopify':
      return new ShopifyProvider({
        shopDomain: config.shop_domain,
        accessToken: config.access_token,
        apiVersion: config.api_version ?? '2024-04',
      });
    default:
      throw new Error(`Unsupported commerce provider: ${config.provider_type}`);
  }
}
