/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * NEXORA Enterprise Operations Cloud - Dodo Payments Webhook Processor
 * Implements Standard Webhooks cryptographic verification, idempotency, and authoritative Firestore updates.
 */

import type { UnwrapWebhookEvent } from 'dodopayments/resources/webhooks/webhooks';
import { getDodoClient, getDodoConfig } from '../config/dodo';
import { resolvePlanFromDodoProductId } from '../config/plans';
import { db } from '../auth/firebaseAuth';

export class WebhookVerificationError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode = 400, code = 'WEBHOOK_VERIFICATION_FAILED') {
    super(message);
    this.name = 'WebhookVerificationError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Verifies webhook signature using Dodo Payments SDK unwrap helper.
 * Completely exception-safe: validates body, JSON structure, and cryptographic signatures.
 */
export function verifyAndParseDodoWebhook(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>
): UnwrapWebhookEvent {
  // 1. Enforce non-empty string body
  if (!rawBody || typeof rawBody !== 'string' || !rawBody.trim()) {
    throw new WebhookVerificationError(
      'Malformed webhook request: body cannot be empty',
      400,
      'EMPTY_WEBHOOK_BODY'
    );
  }

  // 2. Validate JSON syntax safely before SDK unwrap
  let parsedPayload: any;
  try {
    parsedPayload = JSON.parse(rawBody);
  } catch {
    throw new WebhookVerificationError(
      'Malformed webhook request: invalid JSON format',
      400,
      'MALFORMED_JSON_PAYLOAD'
    );
  }

  if (!parsedPayload || typeof parsedPayload !== 'object' || Array.isArray(parsedPayload)) {
    throw new WebhookVerificationError(
      'Malformed webhook request: payload must be a JSON object',
      400,
      'INVALID_PAYLOAD_OBJECT'
    );
  }

  const config = getDodoConfig();
  const dodo = getDodoClient();

  // Normalize headers to Record<string, string> with lowercase keys
  const normalizedHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (v !== undefined) {
      normalizedHeaders[k.toLowerCase()] = Array.isArray(v) ? v[0] : String(v);
    }
  }

  // Extract signature headers (supports Standard Webhooks and Svix conventions)
  const msgId = normalizedHeaders['webhook-id'] || normalizedHeaders['svix-id'];
  const msgSignature = normalizedHeaders['webhook-signature'] || normalizedHeaders['svix-signature'];
  const msgTimestamp = normalizedHeaders['webhook-timestamp'] || normalizedHeaders['svix-timestamp'];

  // If webhook key is configured, strictly verify signatures
  if (config.webhookKey) {
    if (!msgSignature || !msgId || !msgTimestamp) {
      throw new WebhookVerificationError(
        'Missing required webhook signature headers (webhook-id, webhook-signature, webhook-timestamp)',
        400,
        'WEBHOOK_SIGNATURE_MISSING'
      );
    }

    try {
      return dodo.webhooks.unwrap(rawBody, {
        headers: normalizedHeaders,
        key: config.webhookKey,
      });
    } catch (err: any) {
      const msg = err?.message || 'Signature verification failed';
      throw new WebhookVerificationError(
        `Invalid Dodo webhook signature: ${msg}`,
        400,
        'WEBHOOK_SIGNATURE_INVALID'
      );
    }
  } else {
    // If webhook key is NOT configured in secrets:
    // Reject in production to prevent forged inbound billing events
    const isTestMode = process.env.NODE_ENV === 'test' || process.env.ALLOW_UNSAFE_WEBHOOK === 'true';
    if (!isTestMode) {
      throw new WebhookVerificationError(
        'DODO_PAYMENTS_WEBHOOK_KEY must be configured in environment secrets to verify webhook authenticity',
        500,
        'WEBHOOK_KEY_NOT_CONFIGURED'
      );
    }

    if (!msgSignature) {
      throw new WebhookVerificationError(
        'Missing webhook signature and DODO_PAYMENTS_WEBHOOK_KEY is not configured',
        400,
        'WEBHOOK_SIGNATURE_MISSING'
      );
    }

    try {
      return dodo.webhooks.unsafeUnwrap(rawBody);
    } catch (err: any) {
      throw new WebhookVerificationError(
        `Failed to parse webhook payload: ${err.message}`,
        400,
        'WEBHOOK_PARSE_FAILED'
      );
    }
  }
}

/**
 * Finds the organization ID associated with the webhook payload.
 */
async function resolveOrganizationId(event: UnwrapWebhookEvent): Promise<string | null> {
  const data = (event as any).data || {};

  // 1. Check direct metadata on event data
  if (data.metadata?.orgId) {
    return data.metadata.orgId;
  }

  // 2. Check customer metadata
  if (data.customer?.metadata?.orgId) {
    return data.customer.metadata.orgId;
  }

  // 3. Query by subscription_id if present
  const subscriptionId = data.subscription_id || data.subscription?.subscription_id;
  if (subscriptionId) {
    try {
      const orgBySub = await db
        .collection('organizations')
        .where('dodoSubscriptionId', '==', subscriptionId)
        .limit(1)
        .get();
      if (!orgBySub.empty) {
        return orgBySub.docs[0].id;
      }
    } catch (err: any) {
      console.warn(`[resolveOrganizationId] Firestore query by subscriptionId error: ${err.message}`);
    }
  }

  // 4. Query by customer_id if present
  const customerId = data.customer_id || data.customer?.customer_id;
  if (customerId) {
    try {
      const orgByCust = await db
        .collection('organizations')
        .where('dodoCustomerId', '==', customerId)
        .limit(1)
        .get();
      if (!orgByCust.empty) {
        return orgByCust.docs[0].id;
      }
    } catch (err: any) {
      console.warn(`[resolveOrganizationId] Firestore query by customerId error: ${err.message}`);
    }
  }

  return null;
}

/**
 * Core idempotent webhook event handler.
 */
export async function processDodoWebhookEvent(
  event: UnwrapWebhookEvent,
  eventId: string
): Promise<{ processed: boolean; eventType: string; orgId: string | null }> {
  // Idempotency check in Firestore
  const eventRef = db.collection('platform').doc('dodoEvents').collection('items').doc(eventId);
  try {
    const eventSnap = await eventRef.get();
    if (eventSnap.exists && eventSnap.data()?.status === 'processed') {
      console.log(`[DodoWebhook] Duplicate event ${eventId} already processed. Skipping.`);
      return { processed: true, eventType: event.type, orgId: eventSnap.data()?.orgId || null };
    }
  } catch (err: any) {
    console.warn(`[DodoWebhook] Idempotency cache check warning: ${err.message}`);
  }

  const orgId = await resolveOrganizationId(event);
  const now = new Date().toISOString();
  const eventType = event?.type || 'unknown';
  const data = (event as any)?.data || {};

  console.log(`[DodoWebhook] Processing event "${eventType}" for orgId: "${orgId}" (delivery ID: ${eventId})`);

  if (!orgId) {
    console.warn(`[DodoWebhook] Event ${eventType} received without identifiable organization. Recording audit.`);
    try {
      await eventRef.set({
        eventId,
        type: eventType || 'unknown',
        status: 'unmatched_org',
        timestamp: (event as any)?.timestamp || now,
        dataSummary: {
          subscriptionId: data.subscription_id || null,
          customerId: data.customer_id || data.customer?.customer_id || null,
          paymentId: data.payment_id || null,
        },
        receivedAt: now,
      });
    } catch (e: any) {
      console.warn(`[DodoWebhook] Could not persist unmatched audit: ${e.message}`);
    }
    return { processed: false, eventType, orgId: null };
  }

  const orgRef = db.collection('organizations').doc(orgId);
  const billingCurrentRef = orgRef.collection('billing').doc('current');

  switch (eventType) {
    case 'subscription.active': {
      const planCode = resolvePlanFromDodoProductId(data.product_id);
      const subId = data.subscription_id;
      const custId = data.customer?.customer_id;

      try {
        await orgRef.set({
          planId: planCode,
          billingStatus: 'ACTIVE',
          subscriptionStatus: 'ACTIVE',
          ...(subId ? { dodoSubscriptionId: subId } : {}),
          ...(custId ? { dodoCustomerId: custId } : {}),
          updatedAt: now,
        }, { merge: true });

        await billingCurrentRef.set(
          {
            planCode,
            subscriptionId: subId || null,
            customerId: custId || null,
            status: 'active',
            nextBillingDate: data.next_billing_date || null,
            previousBillingDate: data.previous_billing_date || null,
            currency: data.currency || 'INR',
            recurringPreTaxAmount: data.recurring_pre_tax_amount || 0,
            cancelAtNextBillingDate: Boolean(data.cancel_at_next_billing_date),
            updatedAt: now,
          },
          { merge: true }
        );
      } catch (err: any) {
        console.warn(`[DodoWebhook] Firestore write warning in subscription.active: ${err.message}`);
      }
      break;
    }

    case 'subscription.renewed': {
      try {
        await orgRef.set({
          billingStatus: 'ACTIVE',
          subscriptionStatus: 'ACTIVE',
          updatedAt: now,
        }, { merge: true });

        await billingCurrentRef.set(
          {
            status: 'active',
            nextBillingDate: data.next_billing_date || null,
            previousBillingDate: data.previous_billing_date || null,
            updatedAt: now,
          },
          { merge: true }
        );
      } catch (err: any) {
        console.warn(`[DodoWebhook] Firestore write warning in subscription.renewed: ${err.message}`);
      }
      break;
    }

    case 'subscription.plan_changed': {
      const newPlanCode = resolvePlanFromDodoProductId(data.product_id);

      try {
        await orgRef.set({
          planId: newPlanCode,
          billingStatus: 'ACTIVE',
          subscriptionStatus: 'ACTIVE',
          updatedAt: now,
        }, { merge: true });

        await billingCurrentRef.set(
          {
            planCode: newPlanCode,
            status: 'active',
            nextBillingDate: data.next_billing_date || null,
            recurringPreTaxAmount: data.recurring_pre_tax_amount || 0,
            updatedAt: now,
          },
          { merge: true }
        );
      } catch (err: any) {
        console.warn(`[DodoWebhook] Firestore write warning in subscription.plan_changed: ${err.message}`);
      }
      break;
    }

    case 'subscription.cancelled': {
      try {
        if (data.status === 'cancelled') {
          // Immediate cancellation: revert to FREE
          await orgRef.set({
            planId: 'FREE',
            billingStatus: 'INACTIVE',
            subscriptionStatus: 'CANCELLED',
            updatedAt: now,
          }, { merge: true });

          await billingCurrentRef.set(
            {
              planCode: 'FREE',
              status: 'cancelled',
              cancelledAt: now,
              updatedAt: now,
            },
            { merge: true }
          );
        } else {
          // Cancel at end of cycle
          await orgRef.set({
            subscriptionStatus: 'CANCELLING_AT_PERIOD_END',
            updatedAt: now,
          }, { merge: true });

          await billingCurrentRef.set(
            {
              cancelAtNextBillingDate: true,
              status: 'cancelling',
              updatedAt: now,
            },
            { merge: true }
          );
        }
      } catch (err: any) {
        console.warn(`[DodoWebhook] Firestore write warning in subscription.cancelled: ${err.message}`);
      }
      break;
    }

    case 'subscription.expired': {
      try {
        await orgRef.set({
          planId: 'FREE',
          billingStatus: 'EXPIRED',
          subscriptionStatus: 'EXPIRED',
          updatedAt: now,
        }, { merge: true });

        await billingCurrentRef.set(
          {
            planCode: 'FREE',
            status: 'expired',
            expiredAt: now,
            updatedAt: now,
          },
          { merge: true }
        );
      } catch (err: any) {
        console.warn(`[DodoWebhook] Firestore write warning in subscription.expired: ${err.message}`);
      }
      break;
    }

    case 'subscription.on_hold': {
      try {
        await orgRef.set({
          billingStatus: 'PAST_DUE',
          subscriptionStatus: 'ON_HOLD',
          updatedAt: now,
        }, { merge: true });

        await billingCurrentRef.set(
          {
            status: 'on_hold',
            updatedAt: now,
          },
          { merge: true }
        );
      } catch (err: any) {
        console.warn(`[DodoWebhook] Firestore write warning in subscription.on_hold: ${err.message}`);
      }
      break;
    }

    case 'subscription.paused': {
      try {
        await orgRef.set({
          subscriptionStatus: 'PAUSED',
          updatedAt: now,
        }, { merge: true });

        await billingCurrentRef.set(
          {
            status: 'paused',
            updatedAt: now,
          },
          { merge: true }
        );
      } catch (err: any) {
        console.warn(`[DodoWebhook] Firestore write warning in subscription.paused: ${err.message}`);
      }
      break;
    }

    case 'subscription.unpaused': {
      try {
        await orgRef.set({
          billingStatus: 'ACTIVE',
          subscriptionStatus: 'ACTIVE',
          updatedAt: now,
        }, { merge: true });

        await billingCurrentRef.set(
          {
            status: 'active',
            updatedAt: now,
          },
          { merge: true }
        );
      } catch (err: any) {
        console.warn(`[DodoWebhook] Firestore write warning in subscription.unpaused: ${err.message}`);
      }
      break;
    }

    case 'subscription.updated': {
      const planCode = data.product_id ? resolvePlanFromDodoProductId(data.product_id) : undefined;
      const subStatus = data.status ? String(data.status).toUpperCase() : undefined;

      try {
        await orgRef.set({
          ...(planCode ? { planId: planCode } : {}),
          ...(subStatus ? { subscriptionStatus: subStatus } : {}),
          updatedAt: now,
        }, { merge: true });

        await billingCurrentRef.set(
          {
            ...(planCode ? { planCode } : {}),
            ...(data.status ? { status: data.status } : {}),
            ...(data.next_billing_date ? { nextBillingDate: data.next_billing_date } : {}),
            updatedAt: now,
          },
          { merge: true }
        );
      } catch (err: any) {
        console.warn(`[DodoWebhook] Firestore write warning in subscription.updated: ${err.message}`);
      }
      break;
    }

    case 'subscription.past_due': {
      try {
        await orgRef.set({
          billingStatus: 'PAST_DUE',
          subscriptionStatus: 'PAST_DUE',
          updatedAt: now,
        }, { merge: true });

        await billingCurrentRef.set(
          {
            status: 'past_due',
            updatedAt: now,
          },
          { merge: true }
        );
      } catch (err: any) {
        console.warn(`[DodoWebhook] Firestore write warning in subscription.past_due: ${err.message}`);
      }
      break;
    }

    case 'subscription.failed': {
      try {
        await orgRef.set({
          billingStatus: 'FAILED',
          subscriptionStatus: 'FAILED',
          updatedAt: now,
        }, { merge: true });

        await billingCurrentRef.set(
          {
            status: 'failed',
            lastError: data.error_message || 'Subscription processing failed',
            updatedAt: now,
          },
          { merge: true }
        );
      } catch (err: any) {
        console.warn(`[DodoWebhook] Firestore write warning in subscription.failed: ${err.message}`);
      }
      break;
    }

    case 'payment.cancelled': {
      const paymentId = data.payment_id;
      if (paymentId) {
        try {
          await orgRef.collection('billing').doc('invoices').collection('items').doc(paymentId).set({
            paymentId,
            amount: data.total_amount || 0,
            currency: data.currency || 'INR',
            status: 'CANCELLED',
            createdAt: data.created_at || now,
          }, { merge: true });
        } catch (err: any) {
          console.warn(`[DodoWebhook] Firestore write warning in payment.cancelled: ${err.message}`);
        }
      }
      break;
    }

    case 'payment.succeeded': {
      const paymentId = data.payment_id;
      try {
        if (paymentId) {
          await orgRef.collection('billing').doc('invoices').collection('items').doc(paymentId).set({
            paymentId,
            amount: data.total_amount || 0,
            currency: data.currency || 'INR',
            status: 'SUCCEEDED',
            subscriptionId: data.subscription_id || null,
            customerId: data.customer?.customer_id || null,
            createdAt: data.created_at || now,
          }, { merge: true });
        }

        await orgRef.set({
          billingStatus: 'ACTIVE',
          updatedAt: now,
        }, { merge: true });
      } catch (err: any) {
        console.warn(`[DodoWebhook] Firestore write warning in payment.succeeded: ${err.message}`);
      }
      break;
    }

    case 'payment.failed': {
      const paymentId = data.payment_id;
      try {
        if (paymentId) {
          await orgRef.collection('billing').doc('invoices').collection('items').doc(paymentId).set({
            paymentId,
            amount: data.total_amount || 0,
            currency: data.currency || 'INR',
            status: 'FAILED',
            errorMessage: data.error_message || 'Payment transaction failed',
            createdAt: data.created_at || now,
          }, { merge: true });
        }

        await billingCurrentRef.set(
          {
            lastPaymentError: data.error_message || 'Payment attempt failed',
            lastFailedAt: now,
          },
          { merge: true }
        );
      } catch (err: any) {
        console.warn(`[DodoWebhook] Firestore write warning in payment.failed: ${err.message}`);
      }
      break;
    }

    default:
      console.log(`[DodoWebhook] Unhandled event type: "${eventType}". Recorded.`);
      break;
  }

  // Mark event as processed in idempotency register
  try {
    await eventRef.set({
      eventId,
      type: eventType || 'unknown',
      orgId: orgId || null,
      status: 'processed',
      timestamp: (event as any)?.timestamp || now,
      processedAt: now,
    });
  } catch (err: any) {
    console.warn(`[DodoWebhook] Idempotency register write warning: ${err.message}`);
  }

  return { processed: true, eventType, orgId };
}
