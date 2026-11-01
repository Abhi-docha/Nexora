/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * NEXORA Enterprise Operations Cloud - Dodo Payments Backend Types
 */

export type PlanCode = 'FREE' | 'STARTER' | 'GROWTH' | 'SCALE';

export interface PlanLimits {
  seats: number;
  projects: number; // 999999 means unlimited
  workflows: number;
  automationRules: number;
  cloudStorageGb: number;
  aiCreditsMonthly: number;
}

export interface PlanFeatures {
  basicModules: boolean;
  incidentWarRoom: boolean;
  exportReports: boolean;
  slaEscalationEngine: boolean;
  scheduledRuns: boolean;
  customRoles: boolean;
  workflowReplay: boolean;
  capacityPlanning: boolean;
  governanceWarRoom: boolean;
  unlimitedProjects: boolean;
}

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  monthlyPriceInr: number;
  priceFormatted: string;
  description: string;
  dodoProductIdEnvVar: string;
  limits: PlanLimits;
  features: PlanFeatures;
}

export interface AuthContext {
  uid: string;
  email?: string;
  emailVerified?: boolean;
  token?: string;
}

export interface BillingStateResponse {
  orgId: string;
  planCode: PlanCode;
  billingStatus: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'INACTIVE' | 'EXPIRED' | 'TRIAL';
  subscriptionStatus: string;
  dodoCustomerId?: string;
  dodoSubscriptionId?: string;
  nextBillingDate?: string | null;
  cancelAtNextBillingDate?: boolean;
  priceInr: number;
  limits: PlanLimits;
  features: PlanFeatures;
}

export interface CreateCheckoutSessionRequest {
  orgId: string;
  planCode: PlanCode;
  returnUrl?: string;
}

export interface CreateCheckoutSessionResponse {
  checkoutUrl: string;
  sessionId: string;
  planCode: PlanCode;
  amountInr: number;
}

export interface ChangePlanRequest {
  orgId: string;
  targetPlanCode: PlanCode;
}

export interface CancelSubscriptionRequest {
  orgId: string;
  immediately?: boolean;
}

export interface ReactivateSubscriptionRequest {
  orgId: string;
}

export interface CreatePortalSessionRequest {
  orgId: string;
  returnUrl?: string;
}
