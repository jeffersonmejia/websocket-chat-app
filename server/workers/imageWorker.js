import { parentPort } from 'node:worker_threads';
import sharp from 'sharp';

parentPort.on('message', async ({ id, data, type }) => {
  try {
    let output = Buffer.from(data);
    if (type !== 'image/gif') {
      const image = sharp(output, { limitInputPixels: 40_000_000 });
      const metadata = await image.metadata();
      // Keep multi-page formats intact; sharp would otherwise process only a frame.
      if ((metadata.pages || 1) === 1) {
        let pipeline = image.rotate().resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true });
        if (type === 'image/jpeg') pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });
        else if (type === 'image/png') pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
        else if (type === 'image/webp') pipeline = pipeline.webp({ quality: 82 });
        const optimized = await pipeline.toBuffer();
        if (optimized.length < output.length) output = optimized;
      }
    }
    const result = Uint8Array.from(output);
    parentPort.postMessage({ id, data: result.buffer }, [result.buffer]);
  } catch (error) {
    parentPort.postMessage({ id, error: 'No se pudo procesar la imagen.' });
  }
});
