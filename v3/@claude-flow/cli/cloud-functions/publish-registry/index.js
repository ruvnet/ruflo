/**
 * Claude Flow Plugin Registry Cloud Function
 *
 * Secure IPFS publishing with:
 * - Ed25519 signature verification
 * - Model import/export tracking
 * - Plugin sharing analytics
 * - Download tracking
 *
 * Deploy:
 *   gcloud functions deploy publish-registry \
 *     --gen2 --runtime=nodejs20 --region=us-central1 \
 *     --trigger-http --allow-unauthenticated \
 *     --service-account=plugin-registry-publisher@claude-flow.iam.gserviceaccount.com
 */

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { Storage } from '@google-cloud/storage';
import * as ed from '@noble/ed25519';

const secretManager = new SecretManagerServiceClient();
const storage = new Storage();

const PROJECT_ID = process.env.GCP_PROJECT || 'claude-flow';
const BUCKET_NAME = 'claude-flow-plugin-registry';
const PINATA_API_URL = 'https://api.pinata.cloud';

/**
 * Get secret from Secret Manager
 */
async function getSecret(name) {
  const [version] = await secretManager.accessSecretVersion({
    name: `projects/${PROJECT_ID}/secrets/${name}/versions/latest`,
  });
  return version.payload.data.toString();
}

/**
 * Sign registry with Ed25519
 */
async function signRegistry(registry, privateKeyHex) {
  const privateKey = Buffer.from(privateKeyHex, 'hex');
  const publicKey = await ed.getPublicKeyAsync(privateKey);

  // Create copy without signature fields
  const registryToSign = { ...registry };
  delete registryToSign.registrySignature;
  delete registryToSign.registryPublicKey;

  const message = JSON.stringify(registryToSign);
  const signature = await ed.signAsync(
    new TextEncoder().encode(message),
    privateKey
  );

  return {
    signature: Buffer.from(signature).toString('hex'),
    publicKey: `ed25519:${Buffer.from(publicKey).toString('hex')}`,
  };
}

/**
 * Pin JSON to IPFS via Pinata
 */
async function pinToIPFS(data, name, jwt) {
  const response = await fetch(`${PINATA_API_URL}/pinning/pinJSONToIPFS`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      pinataContent: data,
      pinataMetadata: {
        name,
        keyvalues: {
          type: 'plugin-registry',
          publishedAt: new Date().toISOString(),
          version: data.version || '1.0.0',
        },
      },
      pinataOptions: {
        cidVersion: 1,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Pinata error: ${response.status} - ${error}`);
  }

  return response.json();
}

/**
 * Fetch npm stats for packages
 */
async function fetchNpmStats(packageName) {
  try {
    const [downloadsRes, packageRes] = await Promise.all([
      fetch(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(packageName)}`, {
        signal: AbortSignal.timeout(5000),
      }),
      fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, {
        signal: AbortSignal.timeout(5000),
      }),
    ]);

    const downloads = downloadsRes.ok ? (await downloadsRes.json()).downloads || 0 : 0;
    const version = packageRes.ok ? (await packageRes.json()).version || 'unknown' : 'unknown';

    return { downloads, version };
  } catch {
    return { downloads: 0, version: 'unknown' };
  }
}

/**
 * Track plugin download/share event
 */
async function trackEvent(bucket, eventType, pluginId, metadata = {}) {
  const file = bucket.file(`analytics/${eventType}/${new Date().toISOString().split('T')[0]}.jsonl`);
  const event = JSON.stringify({
    timestamp: new Date().toISOString(),
    eventType,
    pluginId,
    ...metadata,
  }) + '\n';

  try {
    await file.save(event, { resumable: false });
  } catch {
    // Append to existing file
    const [exists] = await file.exists();
    if (exists) {
      const [content] = await file.download();
      await file.save(content.toString() + event);
    }
  }
}

/**
 * Export model/pattern to IPFS
 */
async function exportModel(modelData, jwt) {
  const result = await pinToIPFS(modelData, `claude-flow-model-${Date.now()}`, jwt);
  return {
    cid: result.IpfsHash,
    size: result.PinSize,
    gateways: [
      `https://gateway.pinata.cloud/ipfs/${result.IpfsHash}`,
      `https://ipfs.io/ipfs/${result.IpfsHash}`,
    ],
  };
}

/**
 * Import model from IPFS CID
 */
async function importModel(cid) {
  const gateways = [
    'https://gateway.pinata.cloud',
    'https://ipfs.io',
    'https://dweb.link',
  ];

  for (const gateway of gateways) {
    try {
      const response = await fetch(`${gateway}/ipfs/${cid}`, {
        signal: AbortSignal.timeout(30000),
        headers: { 'Accept': 'application/json' },
      });

      if (response.ok) {
        return {
          success: true,
          data: await response.json(),
          gateway,
        };
      }
    } catch {
      continue;
    }
  }

  return { success: false, error: 'Model not found on any gateway' };
}

/**
 * Main Cloud Function handler
 */
export async function publishRegistry(req, res) {
  // CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  try {
    const { action = 'publish' } = req.query;
    const bucket = storage.bucket(BUCKET_NAME);

    switch (action) {
      case 'publish': {
        // Get secrets
        const [pinataJwt, privateKey] = await Promise.all([
          getSecret('pinata-jwt'),
          getSecret('registry-private-key'),
        ]);

        // Fetch registry from GCS
        const file = bucket.file('registry.json');
        const [content] = await file.download();
        const registry = JSON.parse(content.toString());

        // Update timestamps and fetch live npm stats
        registry.updatedAt = new Date().toISOString();

        // Fetch live stats for each plugin
        for (const plugin of registry.plugins) {
          const stats = await fetchNpmStats(plugin.id);
          plugin.downloads = stats.downloads;
          plugin.version = stats.version !== 'unknown' ? stats.version : plugin.version;
        }

        registry.totalDownloads = registry.plugins.reduce((sum, p) => sum + p.downloads, 0);

        // Sign registry
        const { signature, publicKey } = await signRegistry(registry, privateKey);
        registry.registrySignature = signature;
        registry.registryPublicKey = publicKey;

        // Pin to IPFS
        const pinResult = await pinToIPFS(registry, 'claude-flow-plugin-registry', pinataJwt);

        // Save latest CID to GCS
        await bucket.file('latest-cid.txt').save(pinResult.IpfsHash);

        // Track publish event
        await trackEvent(bucket, 'publish', 'registry', {
          cid: pinResult.IpfsHash,
          pluginCount: registry.plugins.length,
        });

        return res.json({
          success: true,
          cid: pinResult.IpfsHash,
          updatedAt: registry.updatedAt,
          pluginCount: registry.plugins.length,
          totalDownloads: registry.totalDownloads,
          gateways: [
            `https://gateway.pinata.cloud/ipfs/${pinResult.IpfsHash}`,
            `https://ipfs.io/ipfs/${pinResult.IpfsHash}`,
            `https://dweb.link/ipfs/${pinResult.IpfsHash}`,
          ],
          publicKey,
        });
      }

      case 'export-model': {
        const pinataJwt = await getSecret('pinata-jwt');
        const modelData = req.body;

        if (!modelData) {
          return res.status(400).json({ error: 'Model data required' });
        }

        const result = await exportModel(modelData, pinataJwt);
        await trackEvent(bucket, 'model-export', modelData.id || 'unknown');

        return res.json({
          success: true,
          ...result,
        });
      }

      case 'import-model': {
        const { cid } = req.query;

        if (!cid) {
          return res.status(400).json({ error: 'CID required' });
        }

        const result = await importModel(cid);
        await trackEvent(bucket, 'model-import', cid);

        return res.json(result);
      }

      case 'track-download': {
        const { pluginId } = req.body || req.query;

        if (!pluginId) {
          return res.status(400).json({ error: 'Plugin ID required' });
        }

        await trackEvent(bucket, 'download', pluginId);
        return res.json({ success: true });
      }

      case 'analytics': {
        const { period = '7d' } = req.query;

        // Read analytics files
        const [files] = await bucket.getFiles({ prefix: 'analytics/' });
        const analytics = {
          downloads: {},
          exports: 0,
          imports: 0,
          publishes: 0,
        };

        for (const file of files.slice(-7)) { // Last 7 files
          try {
            const [content] = await file.download();
            const lines = content.toString().split('\n').filter(Boolean);
            for (const line of lines) {
              const event = JSON.parse(line);
              if (event.eventType === 'download') {
                analytics.downloads[event.pluginId] = (analytics.downloads[event.pluginId] || 0) + 1;
              } else if (event.eventType === 'model-export') {
                analytics.exports++;
              } else if (event.eventType === 'model-import') {
                analytics.imports++;
              } else if (event.eventType === 'publish') {
                analytics.publishes++;
              }
            }
          } catch {
            continue;
          }
        }

        return res.json(analytics);
      }

      case 'status': {
        // Get latest CID
        try {
          const [content] = await bucket.file('latest-cid.txt').download();
          const cid = content.toString().trim();

          return res.json({
            healthy: true,
            latestCid: cid,
            gateways: [
              `https://gateway.pinata.cloud/ipfs/${cid}`,
              `https://ipfs.io/ipfs/${cid}`,
            ],
          });
        } catch {
          return res.json({
            healthy: false,
            error: 'No registry published yet',
          });
        }
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (error) {
    console.error('Function error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// For local testing
export { signRegistry, fetchNpmStats, trackEvent };
