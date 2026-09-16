import { createRouter } from '../http/router.js';
import { register as registerSetup } from './setup.js';
import { register as registerAuth } from './auth.js';
import { register as registerProjects } from './projects.js';
import { register as registerDeployments } from './deployments.js';
import { register as registerFiles } from './files.js';
import { register as registerServer } from './server.js';
import { register as registerMisc } from './misc.js';

/**
 * Build the platform router.
 *
 * Registration order does not decide matching — the router scores routes by
 * specificity — but it does group the surface area so it is readable here.
 */
export function createPlatformRouter() {
  const router = createRouter();

  registerSetup(router);
  registerAuth(router);
  registerProjects(router);
  registerDeployments(router);
  registerFiles(router);
  registerServer(router);
  registerMisc(router);

  return router;
}
