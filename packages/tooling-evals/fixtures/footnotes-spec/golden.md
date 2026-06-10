# Token Bucket Rate Limiting

This specification defines a token bucket algorithm for limiting request rates. Each client is assigned a bucket of capacity *C* that refills at a fixed rate *r*[^1].

## Algorithm

On each request the server removes one token from the bucket. If no token is available the request is rejected with status 429[^2]. Tokens accrue continuously rather than in discrete intervals, which smooths short bursts[^3].

## Parameters

Implementations must expose both *C* and *r* as configurable values. The default capacity is 60 tokens with a refill rate of one token per second.

## Notes

[^1]: Refill is computed lazily from the elapsed time since the last request.
[^2]: The response should include a `Retry-After` header.
[^3]: A burst up to the full capacity *C* is permitted when the bucket is full.
