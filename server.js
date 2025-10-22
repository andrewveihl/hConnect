// server.js
import express from 'express';
const app = express();

app.get('/healthz', (_req, res) => res.status(200).send('ok'));
app.get('/', (_req, res) => res.status(200).send('backend up'));

const port = Number(process.env.PORT) || 8080;
app.listen(port, '0.0.0.0', () => {
  console.log(`listening on http://0.0.0.0:${port}`);
});
