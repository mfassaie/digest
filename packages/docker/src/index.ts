// Host-side surface only. The service/ sources are bundled into the image
// (dist/docker/service.mjs) and must not be re-exported here — they would
// drag defuddle/linkedom/playwright-core into the app bundle.
export {
  IMAGE, CONTAINER,
  realRunner, detectDocker, imagePresent, ensureContainer,
  DockerUnavailableError,
  type CommandRunner,
} from './host/docker.js';
export {
  checkHealth, containerFetch, type HealthStatus,
} from './host/container-client.js';
export { startBrowserLogFollower } from './host/log-follower.js';
