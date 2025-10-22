import express from 'express';
const app = express();
app.use(express.json());

app.get('/healthz', (_req, res) => res.send('ok'));
app.get('/', (_req, res) => res.send('backend up'));

// example API
app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from Cloud Run!' });
});

const port = Number(process.env.PORT) || 8080;
app.listen(port, '0.0.0.0', () => console.log(`listening on ${port}`));
