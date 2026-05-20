package notifications

// MapPublicUserNotification is the PLA-0039 lint seam for the public
// transport. Internal + public shapes are currently identical;
// divergence (e.g. stripping subscription_id) lands here, not in
// handler call sites.
func MapPublicUserNotification(n UserNotification) UserNotification {
	return n
}
