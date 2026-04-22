import activeWindow from 'active-win';
import screenshot from 'screenshot-desktop';
import { clipboard } from 'electron';
import pino from 'pino';

const logger = pino({ name: 'Capturer' });

export interface CaptureResult {
  title: string;
  app: string;
  pid: number;
  clipboardText: string;
  screenshotBuffer: Buffer | null;
}

export class Capturer {
  public async capture(): Promise<CaptureResult | null> {
    try {
      const activeWin = await activeWindow();
      if (!activeWin) {
        logger.info('No active window found');
        return null;
      }

      // activeWin.owner.name on macOS, activeWin.owner.name / activeWin.title on Windows
      const app = activeWin.owner?.name || 'UnknownApp';
      const title = activeWin.title || 'UnknownTitle';
      const pid = activeWin.owner?.processId || -1;

      let screenshotBuffer: Buffer | null = null;
      try {
        screenshotBuffer = await screenshot({ format: 'png' });
      } catch (e) {
        logger.error('Screenshot failed:', e);
      }

      let clipboardText = '';
      try {
        clipboardText = clipboard.readText().substring(0, 500);
      } catch (e) {
        logger.error('Clipboard read failed:', e);
      }

      return {
        title,
        app,
        pid,
        clipboardText,
        screenshotBuffer
      };
    } catch (e) {
      logger.error('Capture process failed:', e);
      return null;
    }
  }
}
