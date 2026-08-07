import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../dist')));

app.post('/api/upload', upload.single('statement'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  res.json({ message: 'Uploaded successfully', fileName: req.file.originalname });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

const port = process.env.PORT ?? 3000;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
