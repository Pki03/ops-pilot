# Worker restart causing connection loss

## Symptoms
- Periodic connection errors every few minutes
- Worker logs show restart messages coinciding with errors
- Connections not properly closed on worker shutdown

## Investigation Steps
1. Check worker uptime and restart frequency in logs
2. Verify connection pool cleanup on worker shutdown
3. Check if connections survive the cold start period

## Resolution
1. Implement proper connection pool cleanup in onBeforeDelete
2. Use connection pool that supports graceful shutdown
3. Add connection retry logic with exponential backoff
4. Consider using a persistent connection pool outside the worker
