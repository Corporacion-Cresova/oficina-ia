import { createOffice } from './src/safe-office.mjs';
const server = createOffice({ password: process.env.OFFICE_PASSWORD,
  dataDir: process.env.OFFICE_DATA_DIR, publicOrigin: process.env.OFFICE_ORIGIN || '' });
const port = Number(process.env.PORT || 3000);
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log('Manual task scaffold started; inference and external actions disabled.'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
