/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * NEXORA Enterprise Operations Cloud - Billing State Resolver
 */

import { AuthContext, BillingStateResponse, PlanCode } from '../types';
import { getPlanDefinition } from '../config/plans';
import { db, verifyOrgBillingAccess } from '../auth/firebaseAuth';

export async function handleGetBillingState(
  auth: AuthContext,
  orgId: string
): Promise<BillingStateResponse> {
  if (!orgId) {
    throw new Error('Missing orgId');
  }

  const orgData = await verifyOrgBillingAccess(auth, orgId);
  const planCode: PlanCode = (orgData.planId || 'FREE').toUpperCase() as PlanCode;
  const planDef = getPlanDefinition(planCode);

  // Fetch detailed billing subdocument if available
  const billingSnap = await db.collection('organizations').doc(orgId).collection('billing').doc('current').get();
  const billingData = billingSnap.data() || {};

  return {
    orgId,
    planCode,
    billingStatus: orgData.billingStatus || (planCode === 'FREE' ? 'INACTIVE' : 'ACTIVE'),
    subscriptionStatus: orgData.subscriptionStatus || (planCode === 'FREE' ? 'NONE' : 'ACTIVE'),
    dodoCustomerId: orgData.dodoCustomerId || billingData.customerId,
    dodoSubscriptionId: orgData.dodoSubscriptionId || billingData.subscriptionId,
    nextBillingDate: billingData.nextBillingDate || null,
    cancelAtNextBillingDate: Boolean(billingData.cancelAtNextBillingDate),
    priceInr: planDef.monthlyPriceInr,
    limits: planDef.limits,
    features: planDef.features,
  };
}
