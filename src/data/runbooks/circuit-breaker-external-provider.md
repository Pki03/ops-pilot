# Circuit breaker triggered for external provider

## Symptoms
- All external payment provider calls failing
- Circuit breaker is in OPEN state
- Payment processing stopped

## Investigation Steps
1. Check circuit breaker status and failure rate threshold
2. Verify external provider status page
3. Check if the issue is on our side (timeout config) or provider side
4. Review recent configuration changes to circuit breaker

## Resolution
1. If provider issue: wait for provider to restore, then half-open circuit
2. If config issue: adjust timeout and failure threshold
3. Implement fallback payment method while circuit is open
4. Add monitoring for circuit breaker state changes
