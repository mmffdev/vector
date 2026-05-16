// Package libraryreleases SQL constants.
//
// PLA-0048 / RF1.2.16. Most query work is delegated to librarydb; this
// package owns one direct query: the subscription-tier lookup against
// mmff_vector for the entitlement gate.
package libraryreleases

// sqlSelectSubscriptionTier returns the subscription's current tier
// (e.g. 'pro', 'free') for the entitlement-gating logic in
// CountOutstanding / ListSinceAck.
const sqlSelectSubscriptionTier = `SELECT tier FROM subscriptions WHERE id = $1`
