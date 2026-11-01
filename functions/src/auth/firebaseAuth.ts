/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * NEXORA Enterprise Operations Cloud - Firebase Authentication & RBAC Verification
 */

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, DocumentData } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { AuthContext } from '../types';

const projectId =
  process.env.FIREBASE_PROJECT_ID || 'nexora-enterprise';

const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim().replace(/^["']|["']$/g, '');

/**
 * Resolves the Firebase private key supporting base64 encoding (standard for Netlify),
 * or raw multiline strings, with strict precedence:
 * 1. FIREBASE_PRIVATE_KEY_BASE64
 * 2. FIREBASE_PRIVATE_KEY
 * Never logs credentials.
 */
function resolvePrivateKey(): string | undefined {
  // Precedence 1: FIREBASE_PRIVATE_KEY_BASE64
  const base64Key = process.env.FIREBASE_PRIVATE_KEY_BASE64?.trim().replace(/^["']|["']$/g, '');
  if (base64Key) {
    try {
      const decoded = Buffer.from(base64Key, 'base64').toString('utf8');
      if (decoded) {
        return decoded
          .trim()
          .replace(/^["']|["']$/g, '')
          .replace(/\\n/g, '\n');
      }
    } catch {
      // Never log credentials
    }
  }

  // Precedence 2: FIREBASE_PRIVATE_KEY
  const rawKey = process.env.FIREBASE_PRIVATE_KEY?.trim().replace(/^["']|["']$/g, '');
  if (rawKey) {
    return rawKey.replace(/\\n/g, '\n');
  }

  return undefined;
}

const privateKey = resolvePrivateKey();

/*
 * Netlify Functions require explicit service-account credentials
 * (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY / FIREBASE_PRIVATE_KEY_BASE64).
 *
 * Local/Firebase environments can fall back to default project initialization.
 */
let appInstance = getApps().length > 0 ? getApps()[0] : null;

if (!appInstance) {
  if (clientEmail && privateKey) {
    try {
      appInstance = initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey,
        }),
        projectId,
      });
      console.log('[AUTH] Firebase Admin initialized with service account credentials.');
    } catch (initErr: any) {
      console.error('[AUTH] Failed to initialize Firebase Admin with credentials:', initErr.message);
      appInstance = initializeApp({ projectId });
    }
  } else {
    console.warn('[AUTH] Missing service account credentials. Initializing with projectId only.');
    appInstance = initializeApp({ projectId });
  }
}

const app = appInstance;

const firestoreDatabaseId =
  process.env.FIRESTORE_DATABASE_ID ||
  'ai-studio-3b092059-520b-4f77-ac8f-80dfcc7fc88d';

export const db = getFirestore(app, firestoreDatabaseId);
export const auth = getAuth(app);

/**
 * Returns safe diagnostic information about Firebase Admin initialization.
 * NEVER returns secret values.
 */
export function getFirebaseAdminDiagnostics() {
  return {
    isConfigured: Boolean(clientEmail && privateKey),
    projectId,
    hasClientEmail: Boolean(clientEmail && clientEmail.length > 3),
    hasPrivateKey: Boolean(privateKey && privateKey.length > 20),
    privateKeyFormat: process.env.FIREBASE_PRIVATE_KEY_BASE64
      ? 'base64'
      : process.env.FIREBASE_PRIVATE_KEY
      ? 'plain'
      : 'none',
    firestoreDatabaseId,
  };
}

export class AuthError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode = 401, code = 'AUTH_ERROR') {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export async function verifyBearerToken(
  authHeader?: string | null
): Promise<AuthContext> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError(
      'Missing or malformed Authorization header. Expected Bearer <token>.',
      401,
      'AUTH_HEADER_MISSING'
    );
  }

  const token = authHeader.substring(7).trim();

  if (!token) {
    throw new AuthError('Empty Firebase ID token.', 401, 'AUTH_TOKEN_EMPTY');
  }

  try {
    const decoded = await auth.verifyIdToken(token);

    return {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified,
      token,
    };
  } catch (err: any) {
    console.error('[AUTH] Firebase ID token verification failed:', err.message);
    throw new AuthError(
      `Invalid Firebase ID token: ${err.message}`,
      401,
      'AUTH_TOKEN_INVALID'
    );
  }
}

/**
 * Ensures user has billing management permissions for the organization.
 */
export async function verifyOrgBillingAccess(
  user: AuthContext,
  orgId: string
): Promise<DocumentData> {
  const expectedPrimaryOrgId = `org_${user.uid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16).toLowerCase()}`;
  const isPrimaryOrg = orgId === expectedPrimaryOrgId;
  const PLATFORM_ADMIN_EMAIL = 'abhi30382.ak@gmail.com';
  const isPlatformOwner = user.email && user.email.toLowerCase() === PLATFORM_ADMIN_EMAIL;

  try {
    const orgRef = db.collection('organizations').doc(orgId);
    const orgSnap = await orgRef.get();

    if (!orgSnap.exists) {
      // If the orgId matches the user's primary deterministic ID pattern, auto-provision
      if (isPrimaryOrg) {
        console.log(`[AUTH] Auto-provisioning initial org doc for user ${user.uid} (${orgId})`);
        const initialOrg = {
          id: orgId,
          name: `${user.email ? user.email.split('@')[0] : 'Enterprise'}'s Operations Cloud`,
          slug: `org-${user.uid.slice(0, 8).toLowerCase()}`,
          ownerUid: user.uid,
          planId: 'FREE',
          status: 'ACTIVE',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        try {
          await orgRef.set(initialOrg, { merge: true });
        } catch {
          // If Firestore Admin is unauthenticated, safely continue with initialOrg
        }
        return initialOrg;
      }
      throw new AuthError(`Organization ${orgId} not found.`, 404, 'ORG_NOT_FOUND');
    }

    const orgData = orgSnap.data() || {};

    if (orgData.ownerUid === user.uid) {
      return orgData;
    }

    if (isPlatformOwner) {
      return orgData;
    }

    const memberSnap = await orgRef
      .collection('members')
      .doc(user.uid)
      .get();

    if (memberSnap.exists) {
      const memberData = memberSnap.data() || {};

      if (
        memberData.role === 'OWNER' ||
        memberData.role === 'ORG_ADMIN'
      ) {
        return orgData;
      }
    }

    throw new AuthError('Forbidden: Insufficient permissions for organization billing.', 403, 'FORBIDDEN');
  } catch (err: any) {
    if (err instanceof AuthError) throw err;
    // Resilient fallback when Admin SDK lacks service account credentials (e.g. gRPC code 7 PERMISSION_DENIED)
    if (isPrimaryOrg || isPlatformOwner) {
      return {
        id: orgId,
        name: `${user.email ? user.email.split('@')[0] : 'Enterprise'}'s Operations Cloud`,
        slug: `org-${user.uid.slice(0, 8).toLowerCase()}`,
        ownerUid: user.uid,
        planId: 'FREE',
        status: 'ACTIVE',
        billingStatus: 'INACTIVE',
        subscriptionStatus: 'NONE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    throw err;
  }
}
