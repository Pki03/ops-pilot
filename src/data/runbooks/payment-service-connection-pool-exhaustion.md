# Connection pool exhaustion on payment-service

## Symptoms
- Stripe webhook processing timeouts
- Payment processing queue depth increasing
- Database connection errors in payment handler

## Investigation Steps
1. Check PostgreSQL connection count on payment-db
2. Verify Stripe webhook concurrency settings
3. Look for long-running transactions blocking the pool

## Resolution
1. Increase connection pool from 30 to 60
2. Add queue-based processing for webhooks instead of synchronous handling
3. Set statement timeout to 10s to prevent long-running queries
