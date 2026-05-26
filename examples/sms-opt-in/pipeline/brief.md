# Brief — Add SMS notification opt-in to user settings

## 1. Problem

Users currently receive transactional notifications only via email. A subset of users have asked for SMS as an alternative channel for time-sensitive events (login alerts, payment confirmations, scheduled reminders). They want to opt in per-event-type from their account settings.

## 2. User stories

- As a logged-in user, I can see a "Notification channels" section in my account settings.
- As a user, I can opt into SMS for any of: login alerts, payment confirmations, scheduled reminders.
- As a user, I can change my opt-in choices at any time and see the change reflected immediately.
- As a user, I receive a confirmation SMS the first time I opt into a channel, to verify my phone number.
- As an admin, I can audit who opted in/out and when.

## 3. Acceptance criteria

1. The Notification channels section appears in account settings for any logged-in user.
2. The user can toggle SMS on/off independently for each of the three event types.
3. A change to opt-in state is persisted immediately and reflected on page reload.
4. The first opt-in for a new phone number triggers a verification SMS that the user must respond to before any other SMS is sent.
5. An audit log entry is written for every opt-in/opt-out, with user id, channel, event type, and timestamp.

## 4. Out of scope

- Push notifications (separate work item).
- Carrier-specific MMS (rich-media SMS).
- SMS for marketing — only transactional events.
- Channels other than email/SMS (e.g. Slack, Telegram).

## 5. Open questions

- Which SMS provider? (Defer to Principal at design stage; Twilio is the leading candidate.)
- What's the cost model for SMS at our user volume? (Owner: Platform; needs spike before deploy.)

## 6. Rollback plan

The Notification channels UI is gated by a feature flag (`sms_opt_in_v1`). Rollback = flip the flag off. SMS opt-in state in the DB is preserved across rollback so users don't lose their preferences.

## 7. Feature flag

`sms_opt_in_v1` — boolean, per-user override allowed for staged rollout (10% → 50% → 100% over a week).

## 8. Data migration

New columns on `users.notification_preferences`:
- `sms_login_alerts` (boolean, default false)
- `sms_payment_confirmations` (boolean, default false)
- `sms_scheduled_reminders` (boolean, default false)
- `phone_verified_at` (timestamp, nullable)

New table `notification_preference_audit`:
- `id`, `user_id`, `channel`, `event_type`, `old_value`, `new_value`, `changed_at`.

Backfill: existing users get all SMS flags = false; phone_verified_at = NULL. Forward-only migration; no rollback DDL needed.

## 9. Observability requirements

- Counter: `notifications_opt_in_changes_total{channel, event_type, direction}`
- Counter: `sms_sent_total{event_type, outcome}` (outcome: delivered / failed / undeliverable)
- Counter: `sms_verification_attempts_total{outcome}` (success / failure)
- Log: every opt-in change at INFO, every verification at INFO, every SMS-send failure at WARN.

## 10. SLO

- Opt-in change reflected in DB within 200ms (p99).
- Verification SMS sent within 5s of opt-in.
- Transactional SMS sent within 30s of trigger event (p95).

## 11. Cost

- Twilio: ~$0.0075 per SMS in US/Canada. At expected volume (10% opt-in × 100k MAU × ~3 messages/user/month) = ~3000/month = ~$22.50/month. Budget approved.
