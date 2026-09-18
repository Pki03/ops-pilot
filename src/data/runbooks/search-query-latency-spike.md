# Search query latency spike

## Symptoms
- p99 search latency exceeds 5000ms
- Users experiencing slow autocomplete and search results
- High CPU on search nodes

## Investigation Steps
1. Check for slow queries in Elasticsearch slow log
2. Verify query cache hit rate
3. Look for heavy aggregations or wildcard queries
4. Check if any indices have high doc_count with few segments

## Resolution
1. Add or optimize aliases for common queries
2. Increase filter cache size
3. Implement query result caching at the application level
4. Consider using search-as-you-type for autocomplete
