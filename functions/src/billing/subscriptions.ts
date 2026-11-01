/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * NEXORA Enterprise Operations Cloud - Dodo Subscription Lifecycle Manager
 */

import { AuthContext, CancelSubscriptionRequest, ChangePlanRequest, PlanCode, ReactivateSubscriptionRequest } from '../types';
import { getDodoClient } from '../config/dodo';
import { getDodoProductIdForPlan, getPlanDefinition } from '../config/plans';
import { db, verifyOrgBillingAccess } from '../auth/firebaseAuth';

export async function handleChangeSubscriptionPlan(
  auth: AuthContext,
  payload: ChangePlanRequest
): Promise<{ success: boolean; targetPlanCode: PlanCode; message: string }> {
  const { orgId, targetPlanCode } = payload;
  if (!orgId || !targetPlanCode) {
    throw new Error('Missing orgId or targetPlanCode');
  }

  const orgData = await verifyOrgBillingAccess(auth, orgId);
  const currentPlan = (orgData.planId || 'FREE').toUpperCase();

  if (currentPlan === targetPlanCode) {
    throw new Error(`Organization is already subscribed to the ${targetPlanCode} plan.`);
  }

  const subscriptionId = orgData.dodoSubscriptionId;
  if (!subscriptionId) {
    throw new Error(
      `No active Dodo subscription ID found for organization ${orgId}. If upgrading from FREE, please start via checkout.`
    );
  }

  const targetProductId = getDodoProductIdForPlan(targetPlanCode);
  const dodo = getDodoClient();

  // Execute plan modification with proration
  const response = await dodo.subscriptions.changePlan(subscriptionId, {
    product_id: targetProductId,
    proration_billing_mode: 'prorated_immediately',
    quantity: 1,
  });

  // Update Firestore organization and billing state
  const now = new Date().toISOString();
  await db.collection('organizations').doc(orgId).update({
    planId: targetPlanCode,
    updatedAt: now,
  });

  await db.collection('organizations').doc(orgId).collection('billing').doc('current').set(
    {
      planCode: targetPlanCode,
      subscriptionId,
      status: 'active',
      updatedAt: now,
    },
    { merge: true }
  );

  return {
    success: true,
    targetPlanCode,
    message: `Successfully changed subscription plan to ${targetPlanCode}.`,
  };
}

export async function handlePreviewPlanChange(
  auth: AuthContext,
  payload: { orgId: string; targetPlanCode: PlanCode }
): Promise<{ amountDue: number; targetPriceInr: number; currency: string }> {
  const { orgId, targetPlanCode } = payload;
  const orgData = await verifyOrgBillingAccess(auth, orgId);
  const subscriptionId = orgData.dodoSubscriptionId;
  const targetDef = getPlanDefinition(targetPlanCode);

  if (!subscriptionId) {
    return {
      amountDue: targetDef.monthlyPriceInr,
      targetPriceInr: targetDef.monthlyPriceInr,
      currency: 'INR',
    };
  }

  const dodo = getDodoClient();
  const targetProductId = getDodoProductIdForPlan(targetPlanCode);

  try {
    const preview = await dodo.subscriptions.previewChangePlan(subscriptionId, {
      product_id: targetProductId,
      proration_billing_mode: 'prorated_immediately',
      quantity: 1,
    });

    const diff = (preview as any).proration_amount || targetDef.monthlyPriceInr;
    return {
      amountDue: diff,
      targetPriceInr: targetDef.monthlyPriceInr,
      currency: 'INR',
    };
  } catch (err: any) {
    console.warn('[DodoPreview] previewChangePlan failed:', err.message);
    return {
      amountDue: targetDef.monthlyPriceInr,
      targetPriceInr: targetDef.monthlyPriceInr,
      currency: 'INR',
    };
  }
}

export async function handleCancelSubscription(
  auth: AuthContext,
  payload: CancelSubscriptionRequest
): Promise<{ success: boolean; status: string; message: string }> {
  const { orgId, immediately = false } = payload;
  if (!orgId) {
    throw new Error('Missing orgId');
  }

  const orgData = await verifyOrgBillingAccess(auth, orgId);
  const subscriptionId = orgData.dodoSubscriptionId;

  if (!subscriptionId) {
    throw new Error('No active Dodo subscription found to cancel.');
  }

  const dodo = getDodoClient();
  const now = new Date().toISOString();

  if (immediately) {
    // End subscription immediately
    await dodo.subscriptions.update(subscriptionId, {
      status: 'cancelled',
    });

    await db.collection('organizations').doc(orgId).update({
      planId: 'FREE',
      subscriptionStatus: 'CANCELLED',
      billingStatus: 'INACTIVE',
      updatedAt: now,
    });

    await db.collection('organizations').doc(orgId).collection('billing').doc('current').set(
      {
        status: 'cancelled',
        planCode: 'FREE',
        cancelledAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

    return {
      success: true,
      status: 'CANCELLED',
      message: 'Subscription has been cancelled immediately. Plan reverted to FREE.',
    };
  } else {
    // Stop at end of current billing period
    await dodo.subscriptions.update(subscriptionId, {
      cancel_at_next_billing_date: true,
    });

    await db.collection('organizations').doc(orgId).update({
      subscriptionStatus: 'CANCELLING_AT_PERIOD_END',
      updatedAt: now,
    });

    await db.collection('organizations').doc(orgId).collection('billing').doc('current').set(
      {
        cancelAtNextBillingDate: true,
        status: 'cancelling',
        updatedAt: now,
      },
      { merge: true }
    );

    return {
      success: true,
      status: 'CANCELLING_AT_PERIOD_END',
      message: 'Subscription scheduled for cancellation at the end of the current billing cycle.',
    };
  }
}

export async function handleReactivateSubscription(
  auth: AuthContext,
  payload: ReactivateSubscriptionRequest
): Promise<{ success: boolean; status: string; message: string }> {
  const { orgId } = payload;
  if (!orgId) {
    throw new Error('Missing orgId');
  }

  const orgData = await verifyOrgBillingAccess(auth, orgId);
  const subscriptionId = orgData.dodoSubscriptionId;

  if (!subscriptionId) {
    throw new Error('No subscription ID found to reactivate.');
  }

  const dodo = getDodoClient();
  const now = new Date().toISOString();

  // Send status: 'active' alone as required by Dodo API
  await dodo.subscriptions.update(subscriptionId, {
    status: 'active',
  });

  await db.collection('organizations').doc(orgId).update({
    subscriptionStatus: 'ACTIVE',
    billingStatus: 'ACTIVE',
    updatedAt: now,
  });

  await db.collection('organizations').doc(orgId).collection('billing').doc('current').set(
    {
      status: 'active',
      cancelAtNextBillingDate: false,
      updatedAt: now,
    },
    { merge: true }
  );

  return {
    success: true,
    status: 'ACTIVE',
    message: 'Subscription successfully reactivated.',
  };
}
