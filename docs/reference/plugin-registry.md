# Plugin Registry (IPFS/Pinata)

## Location

- CID stored in: `v3/@claude-flow/cli/src/plugins/store/discovery.ts`
- Gateway: `https://gateway.pinata.cloud/ipfs/{CID}`

## Adding a Plugin

1. Fetch current registry:
```bash
curl -s "https://gateway.pinata.cloud/ipfs/$(grep LIVE_REGISTRY_CID v3/@claude-flow/cli/src/plugins/store/discovery.ts | cut -d"'" -f2)" > /tmp/registry.json
```

2. Add plugin entry to `plugins` array, increment `totalPlugins`, update category counts.

3. Upload (credentials from .env, NEVER hardcode):
```bash
PINATA_JWT=$(grep "^PINATA_API_JWT=" .env | cut -d'=' -f2-)
curl -X POST "https://api.pinata.cloud/pinning/pinJSONToIPFS" \
  -H "Authorization: Bearer $PINATA_JWT" \
  -H "Content-Type: application/json" \
  -d @/tmp/registry.json
```

4. Update `LIVE_REGISTRY_CID` in `discovery.ts` and the `demoPluginRegistry` fallback.

## Plugin Commands

```bash
npx claude-flow@v3alpha plugins list
npx claude-flow@v3alpha plugins install @claude-flow/plugin-name
npx claude-flow@v3alpha plugins enable @claude-flow/plugin-name
```
