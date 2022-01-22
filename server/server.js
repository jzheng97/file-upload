const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const Busboy = require('busboy');
const { promisify } = require('util');
const app = express();

const getFileDetails = promisify(fs.stat);

app.use(express.json());
app.use(cors());

const getFilePath = (fileName, fileId) => {
  return `./upload/file-${fileId}-${fileName}`;
};
app.post('/upload-request', (req, res) => {
  if (!req.body || !req.body.fileName) {
    res.status(400).json({ message: 'Missing "fileName"' });
  } else {
    const fileId = uuidv4();
    fs.createWriteStream(getFilePath(req.body.fileName, fileId), {
      flags: 'w',
    });
    res.status(200).json({ fileId, fileName: req.body.fileName });
  }
});

app.get('/upload-status', (req, res) => {
  if (req.query && req.query.fileName && req.query.fileId) {
    getFileDetails(getFilePath(req.query.fileName, req.query.fileId))
      .then((stats) => {
        console.log(getFilePath(req.query.fileName, req.query.fileId));
        res.status(200).json({ totalChunkUploaded: stats.size });
      })
      .catch((e) => {
        console.error('failed to read file', e);
        return res.status(400).json({
          message: 'No file with provided credentials',
          credentials: { ...req.query },
        });
      });
  } else {
    return res.status(400).json({
      message: 'No file with provided credentials',
      credentials: { ...req.query },
    });
  }
});
app.post('/upload', (req, res) => {
  const contentRange = req.headers['content-range'];
  const fileId = req.headers['x-file-id'];

  if (!contentRange) {
    return res.status(400).json({ message: 'Missing "Content-Range" header' });
  }
  if (!fileId) {
    return res.status(400).json({ message: 'Missing "X-File-Id" header' });
  }
  const match = contentRange.match(/bytes=(\d+)-(\d+)\/(\d+)/);
  if (!match) {
    return res.status(400).json({ message: 'Invalid "Content-Range" Format' });
  }

  const rangeStart = Number(match[1]),
    rangeEnd = Number(match[2]),
    fileSize = Number(match[3]);
  if (rangeStart >= fileSize || rangeStart >= rangeEnd || rangeEnd > fileSize) {
    return res
      .status(400)
      .json({ message: 'Invalid "Content-Range" Provided' });
  }

  const busboy = Busboy({ headers: req.headers });

  busboy.on('error', (e) => {
    console.error('Failed to read file', e);
    res.sendStatus(500);
  });

  busboy.on('finish', (e) => {
    res.sendStatus(200);
  });

  busboy.on('file', (_, file, fileInfo) => {
    const filePath = getFilePath(fileInfo.filename, fileId);
    console.log('uploading file, file path is, ', filePath);
    if (!fileId) {
      req.pause();
    }
    getFileDetails(filePath)
      .then((stats) => {
        if (stats.size !== rangeStart) {
          return res.status(400).json({ message: 'Bad chunk range start' });
        }
        file
          .pipe(fs.createWriteStream(filePath, { flags: 'a' }))
          .on('error', (e) => {
            console.error('failed upload', e);
            res.sendStatus(500);
          });
      })
      .catch((e) => {
        console.error('No such file error', e);
        return res.status(400).json({
          message: 'No file with provided credentials',
          credentials: req.query,
        });
      });
  });
  req.pipe(busboy);
});

app.get('*', (req, res) => {
  res.send('It works');
});

app.listen(1234);
console.log('--- listening on port ', 1234);
