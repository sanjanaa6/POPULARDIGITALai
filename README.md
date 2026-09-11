# Coupon Engine CLI

A small PostgreSQL-backed coupon engine built with Node.js. This project supports creating coupons, applying a single coupon to a cart, retrieving coupon state, cancelling orders, and includes the bonus tasks for capped discounts, per-user limits, and stackable coupons.

## Project Overview

The repository already contains the schema, migration files, and CLI wiring. The task was to implement the core business logic in the command files under `src/commands`.

## Implemented Features

- Create coupons with support for:
  - `percent` and `flat` discount types
  - minimum spend checks
  - expiry enforcement
  - global usage limits
  - optional capped percent discounts
  - optional per-user usage limits
- Apply a single coupon to a cart and persist the resulting order
- Retrieve a coupon’s current state, including `times_used`
- Cancel an order and release a coupon’s usage back to the pool
- Bonus task support for validating and applying multiple coupons in one request

## Repository Structure

- `src/commands/createCoupon.js` — creates a coupon
- `src/commands/applyCoupon.js` — validates and applies a single coupon
- `src/commands/getCoupon.js` — fetches coupon details
- `src/commands/cancelOrder.js` — cancels an order and restores usage
- `src/commands/applyCoupons.js` — applies up to one percent and one flat coupon together
- `src/cli.js` — CLI entry point
- `src/db.js` — PostgreSQL pool configuration
- `db/schema.sql` — database schema
- `db/migrate.js` — schema migration
- `db/seed.js` — seed data for local development

## Prerequisites

- Node.js 18+
- Docker Desktop or another local Docker runtime
- PostgreSQL is provided by Docker Compose in this repository

## Local Setup

1. Start PostgreSQL:

```bash
docker compose up -d
```

2. Install dependencies:

```bash
npm install
```

3. Create the environment file:

```bash
cp .env.example .env
```

4. Apply the schema and seed the database:

```bash
npm run db:migrate
npm run db:seed
```

## Run the CLI

Create a coupon:

```bash
node src/cli.js create-coupon WELCOME percent 15 20 2027-01-01T00:00:00Z 50
```

Apply a coupon:

```bash
node src/cli.js apply-coupon 100 WELCOME
```

Get coupon state:

```bash
node src/cli.js get-coupon WELCOME
```

Cancel an order:

```bash
node src/cli.js cancel-order <order-id>
```

## Bonus Task Usage

Stack one percent coupon and one flat coupon on the same cart:

```bash
node src/cli.js apply-coupons 100 CODE1,CODE2
```

Optional `userId` can be passed for coupons that have a per-user limit:

```bash
node src/cli.js apply-coupon 100 WELCOME user-123
```

## Verification

Basic and bonus behaviors were verified locally against a live PostgreSQL instance using the included test script.

Run:

```bash
npm test
```

Verified scenarios include:

- coupon creation and lookup
- percent and flat discount calculation
- min spend enforcement
- expired coupon rejection
- unknown coupon rejection
- global usage limit enforcement
- ordering cancellation and usage release
- capped percent discount (bonus 1)
- per-user usage limit enforcement (bonus 2)
- stacked coupon application (bonus 3)

## Assumptions and Notes

- The implementation uses `SELECT ... FOR UPDATE` in the coupon application paths to make usage-limit checks and coupon updates behave predictably when multiple sessions act on the same coupon at the same time.
- For the stackable coupons bonus, both coupons are validated against the original cart total before the order is created, and the order is rejected entirely if any coupon in the stack is invalid.
- For coupons with `usage_limit_per_user`, a `userId` is required during application.
- Stacked coupons are applied in a deterministic order: percent first, then flat.

## Notes for Reviewers

This solution was implemented to be production-minded and readable, with explicit validation, clear error messages, and predictable database behavior. The implementation also includes small verification tests so the project can be checked quickly after setup.
