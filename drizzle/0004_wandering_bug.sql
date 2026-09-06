CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`vapid_public_key` text NOT NULL,
	`due_today` integer DEFAULT 1 NOT NULL,
	`delivery_time` text DEFAULT '08:00' NOT NULL,
	`time_zone` text NOT NULL,
	`last_sent_date` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`last_test_at` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "push_subscriptions_due_today_boolean" CHECK("push_subscriptions"."due_today" IN (0, 1))
);
