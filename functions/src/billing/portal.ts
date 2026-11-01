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
): Promise<{ portalUrl: string }> {
  const { orgId, returnUrl } = payload;
  if (!orgId) {
    throw new Error('Missing orgId');
  }

  const orgData = await verifyOrgBillingAccess(auth, orgId);
  const customerId = orgData.dodoCustomerId;

  if (!customerId) {
    // If no customer ID is recorded on the organization, check billing doc
    const billingDoc = await db.collection('organizations').doc(orgId).collection('billing').doc('current').get();
    const billingData = billingDoc.data();
    if (!billingData?.customerId) {
      throw new Error(
        'No active Dodo Payments customer record found for this organization. Please activate a subscription first.'
      );
    }
  }

  const effectiveCustomerId = customerId || (await db.collection('organizations').doc(orgId).collection('billing').doc('current').get()).data()?.customerId;
  const dodo = getDodoClient();
  const appBaseUrl = process.env.APP_BASE_URL || 'https://ais-dev-l2cofzf76fo7tsmn7qfwfu-602379153518.asia-southeast1.run.app';
  const effectiveReturnUrl = returnUrl || `${appBaseUrl}?tab=billing`;

  const portalSession = await dodo.customers.customerPortal.create(effectiveCustomerId, {
    return_url: effectiveReturnUrl,
  });

  if (!portalSession.link) {
    throw new Error('Dodo Payments did not return a customer portal link.');
  }

  return { portalUrl: portalSession.link };
}
