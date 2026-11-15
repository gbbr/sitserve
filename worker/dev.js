import { UpstreamDurableObject as UpstreamObject } from './upstream.js';
import { createSimulator } from './simulator.js';
export { default } from './index.js';
export class UpstreamDurableObject extends UpstreamObject {
  constructor(ctx, env) { super(ctx, env, createSimulator); }
}
