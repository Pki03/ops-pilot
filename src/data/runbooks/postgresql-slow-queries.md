# PostgreSQL slow queries

## Symptoms
- Application response times increasing gradually
- Database CPU at high utilization
- Queries taking >1s in pg_stat_statements

## Investigation Steps
1. Run: SELECT query, mean_exec_time, calls FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10
2. Check for missing indexes on frequently queried columns
3. Look for table bloat
4. Check for lock contention

## Resolution
1. Add missing indexes (check EXPLAIN ANALYZE output)
2. Vacuum analyze tables with high bloat
3. Break large queries into smaller batch operations
4. Consider read replicas for analytics queries
