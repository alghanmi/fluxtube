# Encryption keychain

Every secret FluxTube stores in D1 (Miniflux API tokens, the YouTube refresh
token) is encrypted at rest with AES-GCM. Each encrypted value is three
columns: `_ct` (ciphertext), `_iv` (a fresh 12-byte IV per write) and `_kv`
(the key version that encrypted it).

The keys live in the `D1_KEYCHAIN` Worker secret, set on **both** Workers:

```json
{ "current": 2, "keys": { "1": "<base64 32-byte key>", "2": "<base64 32-byte key>" } }
```

- New writes use `current`.
- Reads use whichever version the row records, which must still be listed.
- The dashboard Worker encrypts and decrypts; the sync Worker only decrypts.

## Encrypted columns

| Table                | Columns                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `miniflux_instances` | `api_token_ct`, `api_token_iv`, `api_token_kv`                                                  |
| `config`             | `value_ct`, `value_iv`, `value_kv` (rows where `value_ct` is set, e.g. `youtube_refresh_token`) |

If a migration adds an encrypted column, add it to
`workers/dashboard/src/rotate_keys.ts` as well. Rotation only re-encrypts what
that file lists.

## Rotating a key

1. **Generate a key:** `openssl rand -base64 32`.
2. **Add it as the new current version, keeping the old one.** For example
   `{ "current": 3, "keys": { "2": "<old>", "3": "<new>" } }`. Push the new
   keychain to both Workers, **sync Worker first**. The sync Worker has to be
   able to decrypt values the dashboard writes under the new version (a YouTube
   reconnect, say) before the dashboard starts writing them.
3. **Re-encrypt.** Either use the dashboard (Settings → Encryption →
   _Re-encrypt with current key_), or call
   `POST /api/config/rotate-keys` with the operator Bearer token. The response:
   - `200 { current, rotated, alreadyCurrent }`: every row is on `current`.
   - `500 { error: "rotation_incomplete", failed: [...] }`: **nothing was
     written.** Each listed row names the key version it needs. Put that
     version back in the keychain, push again, and re-run.

   Rotation is idempotent. After a success, running it again returns
   `rotated: 0`, and that is your confirmation.

4. **Drop the old version** from the keychain and push to both Workers again.
   Do this only after step 3 succeeded. A row still on a dropped version can
   never be decrypted, and backups can't help: they deliberately exclude
   secrets, so the credential would have to be re-entered by hand.

No redeploy is needed. Changing a Worker secret takes effect for the Worker's
next request.
