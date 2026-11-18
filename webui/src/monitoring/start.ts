import { reportClientError } from '../diagnostics';
import { getHostCapabilities, setHostCapabilities } from '../hostCapabilities';
import { SENTRY_DSN, monitoringEnabled } from './config';

// Starts the feedback and error reports (sentry.ts) before the web app mounts. They are optional:
// if their chunk does not load (an extension blocking anything named "sentry", a proxy, a dropped
// connection) or the SDK fails to start, the app still opens and "Segnala un problema" goes back
// to an email, since the in-app window could not send.

type MonitoringModule = Pick<typeof import('./sentry'), 'initMonitoring'>;

/** True when the reports started; never throws. Tests pass the DSN and the loader. */
export async function startMonitoring(
  dsn: string = SENTRY_DSN,
  load: () => Promise<MonitoringModule> = () => import('./sentry'),
): Promise<boolean> {
  if (!monitoringEnabled(dsn)) return false;
  try {
    const { initMonitoring } = await load();
    initMonitoring(dsn);
    return true;
  } catch (error) {
    reportClientError('monitoring', error);
    setHostCapabilities({ ...getHostCapabilities(), reportByEmail: true });
    return false;
  }
}
