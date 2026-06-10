# Client.connect()

Open a connection to the Acme service. The call resolves once the handshake completes or rejects on timeout.

## Signature

```typescript
async function connect(
  options: ConnectOptions,
): Promise<Session>
```

## Example

Connect with an API key and a custom timeout:

```javascript
const client = new Client();
const session = await client.connect({
  apiKey: process.env.ACME_KEY,
  timeoutMs: 5000,
});
console.log(session.id);
```

## Options

The `ConnectOptions` object accepts:

- **apiKey** — required credential string.
- **timeoutMs** — handshake timeout, default 3000.
- **retries** — reconnect attempts, default 0.

## Shell setup

```bash
export ACME_KEY="sk-..."
npm install @acme/sdk
```

### Errors

Throws `ConnectTimeout` when the handshake exceeds `timeoutMs`.
