# High latency on checkout-service

## Symptoms
- p99 latency exceeds 2000ms on /api/checkout endpoints
- Increased connection pool wait times
- 5xx errors correlating with latency spikes

## Investigation Steps
1. Check PostgreSQL connection pool status
2. Verify connection pool size vs active connections
3. Check for slow queries in pg_stat_statements

## Resolution
1. If connection pool exhausted: increase pool size from 50 to 100
2. If slow queries found: add index on orders(status, created_at)
3. If connection leaks: check for unclosed connections in payment service integration
