# IPFS Plugin Registry Setup Guide

This guide walks through setting up a live IPFS plugin registry using Google Cloud and Pinata.

## Prerequisites

- Google Cloud account with billing enabled
- Node.js 20+
- `gcloud` CLI installed

## Step 1: Pinata Setup (IPFS Pinning Service)

### 1.1 Create Pinata Account

1. Go to https://pinata.cloud and create an account
2. Navigate to API Keys section
3. Create a new API key with these permissions:
   - `pinning/pinFileToIPFS`: true
   - `pinning/pinJSONToIPFS`: true
   - `pinning/unpin`: true

### 1.2 Save Your Credentials

```bash
# Add to your shell profile (~/.zshrc or ~/.bashrc)
export PINATA_JWT="your-jwt-token-here"
```

### 1.3 Generate IPNS Key (Optional - for stable addressing)

If you have Pinata's paid plan with Dedicated Gateways:

```bash
# Via Pinata dashboard or API
curl -X POST "https://api.pinata.cloud/v3/ipfs/keys" \
  -H "Authorization: Bearer $PINATA_JWT" \
  -H "Content-Type: application/json" \
  -d '{"name": "claude-flow-registry"}'
```

## Step 2: Google Cloud Setup

### 2.1 Create Project

```bash
# Create new project
gcloud projects create claude-flow-registry --name="Claude Flow Registry"

# Set as active project
gcloud config set project claude-flow-registry

# Enable billing (required for Cloud Functions)
gcloud beta billing projects link claude-flow-registry \
  --billing-account=YOUR_BILLING_ACCOUNT_ID
```

### 2.2 Enable Required APIs

```bash
gcloud services enable \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com
```

### 2.3 Create Storage Bucket

```bash
# Create bucket for registry source data
gcloud storage buckets create gs://claude-flow-plugin-registry \
  --location=US \
  --uniform-bucket-level-access

# Enable versioning for rollback
gsutil versioning set on gs://claude-flow-plugin-registry

# Make registry.json publicly readable (optional)
gsutil iam ch allUsers:objectViewer gs://claude-flow-plugin-registry
```

### 2.4 Create Service Account

```bash
# Create service account
gcloud iam service-accounts create plugin-registry-publisher \
  --display-name="Plugin Registry Publisher"

# Grant permissions
gcloud projects add-iam-policy-binding claude-flow-registry \
  --member="serviceAccount:plugin-registry-publisher@claude-flow-registry.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

gcloud projects add-iam-policy-binding claude-flow-registry \
  --member="serviceAccount:plugin-registry-publisher@claude-flow-registry.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### 2.5 Store Secrets

```bash
# Store Pinata JWT
echo -n "$PINATA_JWT" | gcloud secrets create pinata-jwt --data-file=-

# Generate and store Ed25519 signing key
node -e "
const crypto = require('crypto');
const { subtle } = require('crypto').webcrypto;
(async () => {
  const keyPair = await subtle.generateKey(
    { name: 'Ed25519', namedCurve: 'Ed25519' },
    true,
    ['sign', 'verify']
  );
  const privateKey = await subtle.exportKey('pkcs8', keyPair.privateKey);
  const privateKeyHex = Buffer.from(privateKey).toString('hex');
  console.log(privateKeyHex);
})();
" | gcloud secrets create registry-private-key --data-file=-
```

## Step 3: Deploy Cloud Function

### 3.1 Create Function Directory

```bash
mkdir -p cloud-functions/publish-registry
cd cloud-functions/publish-registry
```

### 3.2 Create package.json

```json
{
  "name": "publish-registry",
  "version": "1.0.0",
  "main": "index.js",
  "type": "module",
  "dependencies": {
    "@google-cloud/storage": "^7.0.0",
    "@google-cloud/secret-manager": "^5.0.0",
    "@noble/ed25519": "^2.0.0"
  }
}
```

### 3.3 Create index.js

```javascript
import { Storage } from '@google-cloud/storage';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import * as ed from '@noble/ed25519';

const storage = new Storage();
const secretManager = new SecretManagerServiceClient();

async function getSecret(name) {
  const [version] = await secretManager.accessSecretVersion({
    name: `projects/claude-flow-registry/secrets/${name}/versions/latest`,
  });
  return version.payload.data.toString();
}

export async function publishRegistry(req, res) {
  try {
    // Get secrets
    const pinataJwt = await getSecret('pinata-jwt');
    const privateKey = await getSecret('registry-private-key');

    // Fetch registry from GCS
    const bucket = storage.bucket('claude-flow-plugin-registry');
    const file = bucket.file('registry.json');
    const [content] = await file.download();
    const registry = JSON.parse(content.toString());

    // Update timestamp
    registry.updatedAt = new Date().toISOString();

    // Sign registry
    const registryToSign = { ...registry };
    delete registryToSign.registrySignature;
    delete registryToSign.registryPublicKey;

    const message = JSON.stringify(registryToSign);
    const signature = await ed.signAsync(
      new TextEncoder().encode(message),
      Buffer.from(privateKey, 'hex')
    );
    const publicKey = await ed.getPublicKeyAsync(Buffer.from(privateKey, 'hex'));

    registry.registrySignature = Buffer.from(signature).toString('hex');
    registry.registryPublicKey = `ed25519:${Buffer.from(publicKey).toString('hex')}`;

    // Pin to IPFS
    const pinResponse = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pinataJwt}`,
      },
      body: JSON.stringify({
        pinataContent: registry,
        pinataMetadata: {
          name: 'claude-flow-plugin-registry',
          keyvalues: {
            version: registry.version,
            updatedAt: registry.updatedAt,
          },
        },
      }),
    });

    if (!pinResponse.ok) {
      throw new Error(`Pinata error: ${await pinResponse.text()}`);
    }

    const pinResult = await pinResponse.json();

    res.json({
      success: true,
      cid: pinResult.IpfsHash,
      updatedAt: registry.updatedAt,
      pluginCount: registry.plugins.length,
      gateways: [
        `https://gateway.pinata.cloud/ipfs/${pinResult.IpfsHash}`,
        `https://ipfs.io/ipfs/${pinResult.IpfsHash}`,
      ],
    });
  } catch (error) {
    console.error('Publish failed:', error);
    res.status(500).json({ error: error.message });
  }
}
```

### 3.4 Deploy Function

```bash
gcloud functions deploy publish-registry \
  --gen2 \
  --runtime=nodejs20 \
  --region=us-central1 \
  --source=. \
  --entry-point=publishRegistry \
  --trigger-http \
  --allow-unauthenticated \
  --service-account=plugin-registry-publisher@claude-flow-registry.iam.gserviceaccount.com \
  --set-env-vars=GCP_PROJECT=claude-flow-registry
```

## Step 4: Create Initial Registry

### 4.1 Upload Registry to GCS

```bash
# Generate initial registry
npx tsx scripts/publish-registry.ts --dry-run > registry.json

# Upload to GCS
gsutil cp registry.json gs://claude-flow-plugin-registry/registry.json
```

### 4.2 Trigger First Publish

```bash
# Get function URL
FUNCTION_URL=$(gcloud functions describe publish-registry \
  --gen2 --region=us-central1 --format='value(serviceConfig.uri)')

# Trigger publish
curl -X POST "$FUNCTION_URL"
```

## Step 5: Automate with Cloud Build

### 5.1 Create cloudbuild.yaml

```yaml
steps:
  # Update registry from npm stats
  - name: 'node:20'
    entrypoint: 'npx'
    args: ['tsx', 'scripts/publish-registry.ts', '--dry-run']
    dir: 'v3/@claude-flow/cli'

  # Upload to GCS
  - name: 'gcr.io/cloud-builders/gsutil'
    args: ['cp', 'registry.json', 'gs://claude-flow-plugin-registry/registry.json']

  # Trigger Cloud Function
  - name: 'gcr.io/cloud-builders/curl'
    args: ['-X', 'POST', '${_FUNCTION_URL}']

substitutions:
  _FUNCTION_URL: 'https://us-central1-claude-flow-registry.cloudfunctions.net/publish-registry'

# Run daily at 2am UTC
options:
  logging: CLOUD_LOGGING_ONLY
```

### 5.2 Create Cloud Scheduler Trigger

```bash
gcloud scheduler jobs create http publish-registry-daily \
  --location=us-central1 \
  --schedule="0 2 * * *" \
  --uri="https://us-central1-claude-flow-registry.cloudfunctions.net/publish-registry" \
  --http-method=POST
```

## Step 6: Update Claude Flow CLI

Update `DEFAULT_PLUGIN_STORE_CONFIG` in `discovery.ts`:

```typescript
export const DEFAULT_PLUGIN_STORE_CONFIG: PluginStoreConfig = {
  registries: [
    {
      name: 'claude-flow-official',
      description: 'Official Claude Flow plugin registry',
      // Use the CID from your first publish
      ipnsName: 'YOUR_IPNS_KEY_OR_CID',
      gateway: 'https://gateway.pinata.cloud',
      // Use your public key from the signing step
      publicKey: 'ed25519:YOUR_PUBLIC_KEY',
      trusted: true,
      official: true,
    },
  ],
  // ... rest of config
};
```

## Cost Estimate

| Service | Free Tier | Paid Tier |
|---------|-----------|-----------|
| Pinata | 1GB storage, 100 pins | $20/mo for 100GB |
| GCS | 5GB free | ~$0.02/GB/mo |
| Cloud Functions | 2M invocations free | ~$0.40/million |
| Cloud Scheduler | 3 jobs free | $0.10/job/mo |
| **Total** | **$0** | **~$20/mo** |

## Troubleshooting

### IPNS Resolution Fails
- Ensure the CID is pinned on Pinata
- Try different gateways (ipfs.io, cloudflare-ipfs.com)
- IPNS can take 5-10 minutes to propagate

### Signature Verification Fails
- Ensure the public key in config matches the signing key
- Check that the registry wasn't modified after signing

### Cloud Function Errors
- Check Cloud Logging for detailed errors
- Verify service account has correct permissions
- Test secrets access manually

## References

- [Pinata Docs](https://docs.pinata.cloud/)
- [Google Cloud Functions](https://cloud.google.com/functions/docs)
- [IPFS Gateway Spec](https://docs.ipfs.tech/concepts/ipfs-gateway/)
- [Ed25519 Signatures](https://ed25519.cr.yp.to/)
