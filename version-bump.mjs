import { readFileSync, writeFileSync } from 'fs';

const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
  throw new Error('npm_package_version is not set; run via "npm version <new>"');
}

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync('manifest.json', JSON.stringify(manifest) + '\n');

const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
versions[targetVersion] = minAppVersion;
writeFileSync('versions.json', JSON.stringify(versions, null, '\t') + '\n');
