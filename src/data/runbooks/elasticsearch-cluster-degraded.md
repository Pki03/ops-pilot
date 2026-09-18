# Elasticsearch cluster degraded

## Symptoms
- Cluster health status RED or YELLOW
- Search queries timing out or returning stale results
- High memory/CPU on individual nodes

## Investigation Steps
1. Check cluster health: curl localhost:9200/_cluster/health
2. Identify unassigned shards and their cause
3. Check node disk usage and memory pressure
4. Look for recent index changes that may have caused the issue

## Resolution
1. For RED: restore missing shards from snapshot or re-create the index
2. For YELLOW: allocate unassigned shards to available nodes
3. If disk full: delete old indices or increase storage
4. If memory pressure: increase heap size or add nodes
