# Database connection pool exhaustion

## Symptoms
- Connection timeout errors in application logs
- All pool connections in use, new requests waiting
- Error: "Connection pool exhausted - max 50 connections"

## Investigation Steps
1. Run SELECT count(*), state FROM pg_stat_activity GROUP BY state
2. Check for idle-in-transaction connections
3. Check for connection leaks in application code

## Resolution
1. Immediately increase pool size to absorb the spike
2. Find and fix connection leaks (common in error paths)
3. Set idle-in-transaction timeout to 30s
4. Restart workers to clear leaked connections
