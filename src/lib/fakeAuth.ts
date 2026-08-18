import React from 'react'

// Drop-in replacement for '@clerk/clerk-react' used across the demo clone.
// There is no real auth here — everyone is a signed-in super admin with every
// department unlocked, so every tab's admin-only UI is always visible. This
// file exists purely so components can keep their original
// `import { useUser, useAuth, ... } from '@clerk/clerk-react'` call sites
// (just repointed at this module) with zero logic changes.

export const FAKE_USER = {
  id: 'user_demo',
  firstName: 'Alex',
  lastName: 'Chen',
  fullName: 'Alex Chen',
  imageUrl: null as string | null,
  primaryEmailAddress: { emailAddress: 'alex@yourcompany.io' },
  publicMetadata: {
    role: 'super_admin' as const,
    allowedDepts: ['sales', 'marketing', 'production', 'projects', 'finance', 'management', 'team'],
    blockedDepts: [] as string[],
    earlyAccessDepts: [] as string[],
  },
}

// Stable, module-level singletons — real Clerk memoizes these internally, and
// several components put them straight into a `useEffect`/`useCallback` deps
// array. Returning a fresh function/object on every render (as a naive shim
// would) breaks that referential stability and causes an infinite fetch loop.
const FAKE_GET_TOKEN = async () => 'demo-token'
const FAKE_USER_RESULT = { user: FAKE_USER, isSignedIn: true, isLoaded: true }
const FAKE_AUTH_RESULT = { getToken: FAKE_GET_TOKEN, isSignedIn: true, isLoaded: true, userId: FAKE_USER.id }
const FAKE_CLERK_RESULT = { signOut: async (_opts?: unknown) => {} }

export function useUser() {
  return FAKE_USER_RESULT
}

export function useAuth() {
  return FAKE_AUTH_RESULT
}

export function useClerk() {
  return FAKE_CLERK_RESULT
}

export function SignedIn({ children }: { children: React.ReactNode }) {
  return React.createElement(React.Fragment, null, children)
}

export function SignedOut(_props: { children: React.ReactNode }) {
  return null
}

export function UserButton(_props: { children?: React.ReactNode; appearance?: unknown }) {
  return null
}
UserButton.MenuItems = function UserButtonMenuItems({ children }: { children?: React.ReactNode }) {
  return React.createElement(React.Fragment, null, children)
}
UserButton.Action = function UserButtonAction(_props: { label: string; labelIcon?: React.ReactNode; onClick?: () => void }) {
  return null
}
