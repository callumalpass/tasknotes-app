# Unreleased

## 1.0.7 TestFlight candidate

- Fixed iOS reminder initialization hanging while loading the Firebase plugin.
  Notification permission checks now time out with an explicit retry action,
  and Settings rechecks permissions after authorization changes and app resume.
- Collection names and locations load independently of task counts. Failed
  collection-summary reads show an error and retry action instead of remaining
  on Opening or displaying invented zero counts.
- Added regression coverage using the real Capacitor plugin proxy, including
  explicit permission opt-in, token registration, and notification listener
  cleanup.

This candidate does not claim to fix the authorization callback error in issue
205; reproducing that separate failure still requires iPhone lifecycle evidence.
It is for TestFlight validation, not public App Store submission.
