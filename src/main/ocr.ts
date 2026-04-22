import Tesseract from 'tesseract.js';
import pino from 'pino';

const logger = pino({ name: 'OCR' });

export class OcrService {
  private worker: Tesseract.Worker | null = null;
  private initializing = false;

  async init() {
    if (this.worker || this.initializing) return;
    this.initializing = true;
    try {
      this.worker = await Tesseract.createWorker('eng');
      logger.info('Tesseract worker initialized');
    } catch (e) {
      logger.error('Failed to initialize Tesseract:', e);
    } finally {
      this.initializing = false;
    }
  }

  async recognize(imageBuffer: Buffer): Promise<string> {
    if (!this.worker) {
      await this.init();
    }
    if (!this.worker) {
      logger.error('Tesseract worker not available');
      return '';
    }

    try {
      const { data: { text } } = await this.worker.recognize(imageBuffer);
      return text;
    } catch (e) {
      logger.error('OCR recognition failed:', e);
      return '';
    }
  }

  async terminate() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}
