/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * NEXORA Enterprise Operations Cloud - Dodo Payments SDK Client Configuration
 */

import DodoPayments from 'dodopayments';

let cachedClient: DodoPayments | null = null;

export function getDodoConfig() {
  const apiKey = (process.env.DODO_PAYMENTS_API_KEY || '').trim().replace(/^["']|["']$/g, '');
  const webhookKey = (process.env.DODO_PAYMENTS_WEBHOOK_KEY || '').trim().replace(/^["']|["']$/g, '');
  const rawEnv = (process.env.DODO_PAYMENTS_ENVIRONMENT || '').trim().replace(/^["']|["']$/g, '');
  const environment: 'live_mode' | 'test_mode' = rawEnv === 'live_mode' ? 'live_mode' : 'test_mode';
  
  const starterProductId = (process.env.DODO_PRODUCT_ID_STARTER || 'pdt_0Nov8yee6ubLxUxTanQ4W').trim().replace(/^["']|["']$/g, '');
  const growthProductId = (process.env.DODO_PRODUCT_ID_GROWTH || 'pdt_0NovCVNy88jYWwd4d1rW4').trim().replace(/^["']|["']$/g, '');
  const scaleProductId = (process.env.DODO_PRODUCT_ID_SCALE || 'pdt_0NovHJulEFup7ug9QD6Rp').trim().replace(/^["']|["']$/g, '');

  return {
    apiKey,
    webhookKey,
    environment,
    productIds: {
      STARTER: starterProductId,
      GROWTH: growthProductId,
      SCALE: scaleProductId,
    },
    isConfigured: Boolean(apiKey && apiKey.length > 5),
    isWebhookConfigured: Boolean(webhookKey && webhookKey.length > 5),
  };
}

export function getDodoClient(): DodoPayments {
  if (cachedClient) {
    return cachedClient;
  }

  const config = getDodoConfig();
  if (!config.apiKey) {
    console.warn('[DodoPayments] Warning: DODO_PAYMENTS_API_KEY is not set. Dodo API calls will fail.');
  }

  cachedClient = new DodoPayments({
    bearerToken: config.apiKey || 'not_configured',
    environment: config.environment,
    webhookKey: config.webhookKey || undefined,
  });

  return cachedClient;
}
