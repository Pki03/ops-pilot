# Stripe webhook signature verification failure

## Symptoms
- Stripe webhooks failing with signature verification errors
- Payments not being processed
- Webhook delivery status shows failures in Stripe dashboard

## Investigation Steps
1. Check if Stripe webhook signing secret was recently rotated
2. Verify the webhook endpoint URL matches what's registered in Stripe
3. Check if the webhook signing secret in environment variables matches

## Resolution
1. Re-copy the signing secret from Stripe dashboard to environment
2. Verify webhook endpoint URL is accessible from Stripe's IP ranges
3. Test with a test webhook from Stripe dashboard
