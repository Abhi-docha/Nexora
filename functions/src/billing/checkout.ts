/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * NEXORA Enterprise Operations Cloud - Dodo Payments Checkout Flow
 */

import { AuthContext, CreateCheckoutSessionRequest, CreateCheckoutSessionResponse, PlanCode } from '../types';
import { getDodoClient } from '../config/dodo';
import { getDodoProductIdForPlan, getPlanDefinition } from '../config/plans';
import { db, verifyOrgBillingAccess } from '../auth/firebaseAuth';

export async function handleCreateCheckoutSession(
  auth: AuthContext,
  payload: CreateCheckoutSessionRequest
): Promise<CreateCheckoutSessionResponse> {
  const { orgId, planCode, returnUrl } = payload;

  if (!orgId) {
    throw new Error('Missing orgId');
  }

  const validPlans: PlanCode[] = ['STARTER', 'GROWTH', 'SCALE'];
  if (!validPlans.includes(planCode)) {
    throw new Error(`Invalid planCode "${planCode}". Must be one of: ${validPlans.join(', ')}`);
  }

  // Authorize user has billing permissions on the organization
  const orgData = await verifyOrgBillingAccess(auth, orgId);
  const planDef = getPlanDefinition(planCode);
  const productId = getDodoProductIdForPlan(planCode);

  const dodo = getDodoClient();

  // Determine return URL
  const appBaseUrl = process.env.APP_BASE_URL || 'https://ais-dev-l2cofzf76fo7tsmn7qfwfu-602379153518.asia-southeast1.run.app';
  const effectiveReturnUrl = returnUrl || `${appBaseUrl}?tab=billing&status=checkout_completed`;

  // Attach customer by ID if known, otherwise pass email & display name
  const existingCustomerId = orgData.dodoCustomerId;
  const customerParam = existingCustomerId
    ? { customer_id: existingCustomerId }
    : {
        email: auth.email || `org_${orgId}@nexora.cloud`,
        name: orgData.name || 'Enterprise Customer',
      };

  let session: any;
  try {
    session = await dodo.checkoutSessions.create({
      product_cart: [
        {
          product_id: productId,
          quantity: 1,
        },
      ],
      customer: customerParam,
      return_url: effectiveReturnUrl,
      metadata: {
        orgId,
        planCode,
        userUid: auth.uid,
        userEmail: auth.email || '',
        orgName: orgData.name || '',
      },
    });
  } catch (err: any) {
    console.error('[CHECKOUT] Dodo checkout creation error:', err.message);
    // If existingCustomerId failed (e.g. deleted from test dashboard), retry with email
    if (existingCustomerId && /customer/i.test(err.message)) {
      console.warn(`[CHECKOUT] Customer ID ${existingCustomerId} was rejected. Retrying with email profile.`);
      session = await dodo.checkoutSessions.create({
        product_cart: [
          {
            product_id: productId,
            quantity: 1,
          },
        ],
        customer: {
          email: auth.email || `org_${orgId}@nexora.cloud`,
          name: orgData.name || 'Enterprise Customer',
        },
        return_url: effectiveReturnUrl,
        metadata: {
          orgId,
          planCode,
          userUid: auth.uid,
          userEmail: auth.email || '',
          orgName: orgData.name || '',
        },
      });
    } else {
      throw err;
    }
  }

  if (!session.checkout_url) {
    throw new Error('Dodo Payments did not return a checkout URL for this session.');
  }

  // Record pending checkout session in Firestore safely
  try {
    await db
      .collection('organizations')
      .doc(orgId)
      .collection('billing')
      .doc('pendingCheckout')
      .set(
        {
          sessionId: session.session_id,
          checkoutUrl: session.checkout_url,
          planCode,
          amountInr: planDef.monthlyPriceInr,
          createdAt: new Date().toISOString(),
          initiatedByUid: auth.uid,
        },
        { merge: true }
      );
  } catch (dbErr: any) {
    console.warn('[CHECKOUT] Non-fatal warning saving pendingCheckout in Firestore:', dbErr.message);
  }

  return {
    checkoutUrl: session.checkout_url,
    sessionId: session.session_id,
    planCode,
    amountInr: planDef.monthlyPriceInr,
  };
}
