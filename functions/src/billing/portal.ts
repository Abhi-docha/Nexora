/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * NEXORA Enterprise Operations Cloud - Dodo Customer Billing Portal Session
 */

import { AuthContext, CreatePortalSessionRequest } from '../types';
import { getDodoClient } from '../config/dodo';
import { db, verifyOrgBillingAccess } from '../auth/firebaseAuth';

export async function handleCreateCustomerPortalSession(
  auth: AuthContext,
  payload: CreatePortalSessionRequest
): Promise<{ portalUrl: string; isCheckoutRedirect?: boolean; requiresActivation?: boolean; message?: string }> {
  const { orgId, returnUrl } = payload;
  if (!orgId) {
    throw new Error('Missing orgId');
  }

  const orgData = await verifyOrgBillingAccess(auth, orgId);
  let customerId = orgData.dodoCustomerId;

  if (!customerId) {
    // If no customer ID is recorded on the organization, check billing doc
    try {
      const billingDoc = await db.collection('organizations').doc(orgId).collection('billing').doc('current').get();
      const billingData = billingDoc.data();
      customerId = billingData?.customerId;
    } catch (dbErr: any) {
      console.warn('[PORTAL] Error reading billing doc:', dbErr.message);
    }
  }

  const appBaseUrl = process.env.APP_BASE_URL || 'https://ais-dev-l2cofzf76fo7tsmn7qfwfu-602379153518.asia-southeast1.run.app';
  const effectiveReturnUrl = returnUrl || `${appBaseUrl}?tab=billing`;

  // Attempt auto-provisioning customer in Dodo Payments if not yet present
  if (!customerId) {
    try {
      const dodo = getDodoClient();
      const customerEmail = auth.email || `org_${orgId}@nexora.cloud`;
      const customerName = orgData.name || 'Enterprise Customer';
      const createdCustomer = await dodo.customers.create({
        email: customerEmail,
        name: customerName,
      });

      if (createdCustomer?.customer_id) {
        customerId = createdCustomer.customer_id;
        await db.collection('organizations').doc(orgId).set(
          { dodoCustomerId: customerId, updatedAt: new Date().toISOString() },
          { merge: true }
        );
        await db.collection('organizations').doc(orgId).collection('billing').doc('current').set(
          { customerId, updatedAt: new Date().toISOString() },
          { merge: true }
        );
      }
    } catch (createErr: any) {
      console.warn('[PORTAL] Auto-provisioning Dodo customer skipped:', createErr.message);
    }
  }

  // If still no customer ID, seamlessly route to checkout for the organization's plan (default to STARTER if on FREE)
  if (!customerId) {
    const rawPlan = (orgData.planId || 'STARTER').toUpperCase();
    const targetPlan: any = (rawPlan === 'GROWTH' || rawPlan === 'SCALE') ? rawPlan : 'STARTER';
    try {
      const { handleCreateCheckoutSession } = await import('./checkout');
      const checkoutRes = await handleCreateCheckoutSession(auth, {
        orgId,
        planCode: targetPlan,
        returnUrl: effectiveReturnUrl,
      });
      return {
        portalUrl: checkoutRes.checkoutUrl,
        isCheckoutRedirect: true,
        requiresActivation: true,
        message: `No active Dodo Payments subscription found. Launching secure checkout to activate ${targetPlan}.`,
      };
    } catch (checkoutErr: any) {
      console.warn('[PORTAL] Checkout fallback failed:', checkoutErr.message);
      const err: any = new Error(
        'No active Dodo Payments customer record found for this organization. Please activate a subscription first.'
      );
      err.statusCode = 400;
      err.requiresActivation = true;
      throw err;
    }
  }

  const dodo = getDodoClient();
  try {
    const portalSession = await dodo.customers.customerPortal.create(customerId, {
      return_url: effectiveReturnUrl,
    });

    if (!portalSession.link) {
      throw new Error('Dodo Payments did not return a customer portal link.');
    }

    return { portalUrl: portalSession.link };
  } catch (portalErr: any) {
    console.warn('[PORTAL] Customer portal creation failed, attempting checkout fallback:', portalErr.message);
    // If Dodo says customer has no active subscriptions or portal not available, fallback to checkout
    const rawPlan = (orgData.planId || 'STARTER').toUpperCase();
    const targetPlan: any = (rawPlan === 'GROWTH' || rawPlan === 'SCALE') ? rawPlan : 'STARTER';
    try {
      const { handleCreateCheckoutSession } = await import('./checkout');
      const checkoutRes = await handleCreateCheckoutSession(auth, {
        orgId,
        planCode: targetPlan,
        returnUrl: effectiveReturnUrl,
      });
      return {
        portalUrl: checkoutRes.checkoutUrl,
        isCheckoutRedirect: true,
        requiresActivation: true,
        message: `No active billing method found in Dodo. Redirecting to checkout for ${targetPlan}.`,
      };
    } catch {
      throw portalErr;
    }
  }
}
