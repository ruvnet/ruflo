#!/usr/bin/env node
/**
 * Preinstall hook: repairs npm/npx cache to prevent ENOTEMPTY and ECOMPROMISED.
 *
 * Handles two common npm bugs in remote/CI/Codespaces environments:
 *   - ENOTEMPTY: leftover .package-XxXxXxXx dirs from interrupted atomic renames
 *   - ECOMPROMISED: corrupted integrity manifests in _cacache
 *
 * Works on Windows, macOS, and Linux. Uses only Node.js built-ins (CJS).
 * Intentionally uses var/ES5 for maximum Node.js compatibility (14+).
 */
var fs = require('fs');
var path = require('path');
var os = require('os');

var npmDir = path.join(os.homedir(), '.npm');

// 1. Clean stale rename artifacts from npx cache (fixes ENOTEMPTY)
try {
  var npxRoot = path.join(npmDir, '_npx');
  if (fs.existsSync(npxRoot)) {
    var dirs = fs.readdirSync(npxRoot);
    for (var i = 0; i < dirs.length; i++) {
      var nm = path.join(npxRoot, dirs[i], 'node_modules');
      if (fs.existsSync(nm) === false) continue;

      try {
        var entries = fs.readdirSync(nm);
        for (var k = 0; k < entries.length; k++) {
          var entry = entries[k];
          // Stale rename targets: .package-name-XxXxXxXx (dot prefix, dash, 8+ alpha suffix)
          if (entry.charAt(0) === '.' && entry.indexOf('-') > 0 && /[A-Za-z]{8}$/.test(entry)) {
            try {
              var p = path.join(nm, entry);
              var stat = fs.statSync(p);
              if (stat.isDirectory()) {
                fs.rmSync(p, { recursive: true, force: true });
              }
            } catch (e) { /* ignore individual failures */ }
          }
        }
      } catch (e) { /* can't read dir, skip */ }
    }
  }
} catch (e) { /* non-fatal */ }

// 2. Remove corrupted integrity entries from _cacache (fixes ECOMPROMISED)
//    Scans index-v5 hash buckets for entries referencing claude-flow or ruflo
//    packages and removes them so npm re-fetches with correct integrity.
try {
  var cacheIndex = path.join(npmDir, '_cacache', 'index-v5');
  if (fs.existsSync(cacheIndex)) {
    // Walk the two-level hash bucket structure: index-v5/XX/YY/...
    var buckets = fs.readdirSync(cacheIndex);
    for (var bi = 0; bi < buckets.length; bi++) {
      var bucketPath = path.join(cacheIndex, buckets[bi]);
      try {
        var stat = fs.statSync(bucketPath);
        if (!stat.isDirectory()) continue;
        var subBuckets = fs.readdirSync(bucketPath);
        for (var si = 0; si < subBuckets.length; si++) {
          var subPath = path.join(bucketPath, subBuckets[si]);
          try {
            var subStat = fs.statSync(subPath);
            if (subStat.isDirectory()) {
              // Third level
              var files = fs.readdirSync(subPath);
              for (var fi = 0; fi < files.length; fi++) {
                var filePath = path.join(subPath, files[fi]);
                try {
                  var content = fs.readFileSync(filePath, 'utf-8');
                  if (content.indexOf('claude-flow') !== -1 || content.indexOf('ruflo') !== -1) {
                    fs.unlinkSync(filePath);
                  }
                } catch (e2) { /* skip unreadable */ }
              }
            } else {
              // File at second level
              try {
                var content2 = fs.readFileSync(subPath, 'utf-8');
                if (content2.indexOf('claude-flow') !== -1 || content2.indexOf('ruflo') !== -1) {
                  fs.unlinkSync(subPath);
                }
              } catch (e2) { /* skip unreadable */ }
            }
          } catch (e2) { /* skip */ }
        }
      } catch (e2) { /* skip unreadable bucket */ }
    }
  }
} catch (e) { /* non-fatal */ }

// 3. Remove stale package-lock.json files from npx cache entries
try {
  if (fs.existsSync(npxRoot)) {
    var cDirs = fs.readdirSync(npxRoot);
    for (var j = 0; j < cDirs.length; j++) {
      var lockFile = path.join(npxRoot, cDirs[j], 'package-lock.json');
      try {
        if (fs.existsSync(lockFile)) {
          var lockStat = fs.statSync(lockFile);
          // Remove lock files older than 1 hour (likely stale)
          var ageMs = Date.now() - lockStat.mtimeMs;
          if (ageMs > 3600000) {
            fs.unlinkSync(lockFile);
          }
        }
      } catch (e) { /* ignore */ }
    }
  }
} catch (e) { /* non-fatal */ }
