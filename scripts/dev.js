import { spawn } from 'node:child_process';
const live = process.argv.includes('--live');
if (live) console.error('WARNING: sitserve live mode contacts dhamma.org. UPSTREAM_CONTACT is required.');
const args = [...(live ? [] : ['--import', './scripts/offline.js']), 'node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--ip', '127.0.0.1', '--persist-to', '.wrangler/state',
  '--var', `UPSTREAM:${live ? 'live' : 'simulator'}`, '--var', `UPSTREAM_SPACING_MS:${live ? '1500' : process.env.UPSTREAM_SPACING_MS || '250'}`];
for (const k of ['SITSERVE_TODAY', 'SIMULATOR_DATE_SHIFT', 'SIMULATOR_FAULT', 'SIMULATOR_SCENARIO', 'SIMULATOR_DELAY_MS', 'UPSTREAM_TIMEOUT_MS', 'UPSTREAM_SLOW_MS', 'UPSTREAM_ALLOWANCE', 'PHOTO_ALLOWANCE', 'VISITOR_SEARCHES_PER_MINUTE', 'SITE_URL'])
  if (process.env[k] !== undefined) args.push('--var', `${k}:${process.env[k]}`);
const child = spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_REGISTRY_PATH: process.cwd() + '/.wrangler/registry',
  WRANGLER_LOG_PATH: process.cwd() + '/.wrangler/logs/', CLOUDFLARE_CF_FETCH_ENABLED: 'false' } });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', code => { process.exitCode = code || 0; });
