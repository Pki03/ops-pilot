# Elevated 5xx after deploy

## Symptoms
- Sudden spike in 5xx errors immediately after a deployment
- Error rate jumps from <1% to >10% within minutes
- Errors are consistent across all instances

## Investigation Steps
1. Check deploy history for the last 30 minutes
2. Identify the exact commit that was deployed
3. Compare error patterns to known issues in the commit
4. Roll back if the deploy is clearly the cause

## Resolution
1. If deploying caused it: rollback to previous version immediately
2. Fix the bug in a hotfix branch
3. Add integration tests to catch similar issues
4. Consider canary deployments to catch regressions earlier
