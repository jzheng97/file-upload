const uploadFiles = (() => {
  const fileRequests = new WeakMap();
  const defaultOptions = {
    url: '/',
    startingByte: 0,
    fileId: '',
    onAbort() {},
    onError() {},
    onProgress() {},
    onComplete() {},
  };

  // Make a new xhp to send the content of the formData
  // When resuming a upload progress, it also creates a new xhr
  // request, the only difference is that the startingByte is
  // different;
  const uploadFileChunks = (file, options) => {
    const req = new XMLHttpRequest();
    const formData = new FormData();
    const chunk = file.slice(options.startingByte);

    formData.append('chunk', chunk, file.name);
    formData.append('fileId', options.fileId);

    req.open('POST', options.url, true);

    req.setRequestHeader('X-File-Id', options.fileId);
    req.setRequestHeader(
      'Content-Range',
      `bytes=${options.startingByte}-${options.startingByte + chunk.size}/${
        file.size
      }`
    );

    req.onload = (e) => options.onComplete(e, file);
    req.onerror = (e) => options.onError(e, file);
    req.ontimeout = (e) => options.onError(e, file);
    // e is event object during xhr request uploading process
    req.upload.onprogress = (e) => {
      const loaded = options.startingByte + e.loaded;
      options.onProgress({ ...e, loaded, total: file.size }, file);
    };
    req.onabort = (e) => options.onAbort(e, file);

    fileRequests.get(file).request = req;

    req.send(formData);
  };

  // Before sending the content of the file.Tell the server the name of the
  // file and make server generate and response an uuid to that file
  const uploadFile = (file, options) => {
    fetch('http://localhost:1234/upload-request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fileName: file.name }),
    })
      .then((res) => res.json())
      .then((res) => {
        options = { ...options, fileId: res.fileId };
        console.log(options);
        fileRequests.set(file, { request: null, options });
        uploadFileChunks(file, { ...options, fileId: res.fileId });
      });
  };

  const abortFileUpload = (file) => {
    const fileReq = fileRequests.get(file);

    if (fileReq) {
      fileReq.request.abort();
    }
  };

  const clearFileUpload = (file) => {
    abortFileUpload(file);
    fileRequests.delete(file);
  };

  const retryFileUpload = (file) => {
    const fileReq = fileRequests.get(file);
    if (fileReq) {
      uploadFileChunks(file, fileReq.options);
    }
  };

  const resumeFileUpload = (file) => {
    const fileReq = fileRequests.get(file);
    fetch(
      `http://localhost:1234/upload-status?fileName=${file.name}&fileId=${fileReq.options.fileId}`
    )
      .then((res) => res.json())
      .then((res) => {
        console.log('--status ', res);
        uploadFileChunks(file, {
          ...fileReq.options,
          startingByte: res.totalChunkUploaded,
        });
      });
  };

  return (files, options = defaultOptions) => {
    [...files].forEach((file) =>
      uploadFile(file, { ...defaultOptions, ...options })
    );
    return {
      abortFileUpload,
      clearFileUpload,
      resumeFileUpload,
      retryFileUpload,
    };
  };
})();

// Connect with UI
const uploadAndTrackFiles = (() => {
  let uploader = {};
  const FILE_STATUS = {
    PENDING: 'pending',
    UPLOADING: 'uploading',
    PAUSED: 'paused',
    COMPLETED: 'completed',
    FAILED: 'failed',
  };

  const files = new Map();
  const progressBox = document.createElement('div');
  progressBox.className = 'upload-progress-tracker';
  progressBox.innerHTML = `
    <h3>Upload</h3>
    <div class="file-progress-wrapper"></div>
  `;

  const fileProgressWrapper = progressBox.querySelector(
    '.file-progress-wrapper'
  );
  const setFileElement = (file) => {
    const fileElement = document.createElement('div');
    fileElement.className = 'upload-progress-tracker';
    fileElement.innerHTML = `
      <div class="file-details">
        <p>
          <span class="file-name">${file.name}</span> 
          <span class="file-status">${file.status}</span>
          <span class="file-ext">${FILE_STATUS.PENDING}</span>
        </p>
        <div class='progress-bar' style='width: 0;height: 2px; background: green;'></div>
      </div>
      <div class='file-actions'>
        <button type='button' class='pause-btn'>Pause</button>
        <button type='button' class='resume-btn'>Resume</button>
        <button type='button' class='retry-btn'>Retry</button>
        <button type='button' class='clear-btn'>Clear</button>
      </div>
    `;

    files.set(file, {
      status: FILE_STATUS.PENDING,
      size: file.size,
      percentage: 0,
      fileElement,
    });

    const [
      ,
      {
        children: [pauseBtn, resumeBtn, retryBtn, clearBtn],
      },
    ] = fileElement.children;
    pauseBtn.addEventListener('click', () => uploader.abortFileUpload(file));
    resumeBtn.addEventListener('click', () => uploader.resumeFileUpload(file));
    retryBtn.addEventListener('click', () => uploader.retryFileUpload(file));
    clearBtn.addEventListener('click', () => {
      uploader.clearFileUpload(file);
      files.delete(file);
      fileElement.remove();
    });
    fileProgressWrapper.appendChild(fileElement);
  };

  const updateFileElement = (fileObj) => {
    const [
      {
        children: [
          {
            children: [, fileStatus],
          },
          progressBar,
        ],
      },
      {
        children: [pauseBtn, resumeBtn, retryBtn, clearBtn],
      },
    ] = fileObj.fileElement.children;

    requestAnimationFrame(() => {
      fileStatus.textContent = fileObj.status;
      fileStatus.className = `status ${fileObj.status}`;
      progressBar.style.width = fileObj.percentage + '%';
      progressBar.style.background =
        fileObj.status === FILE_STATUS.COMPLETED
          ? 'green'
          : fileObj.status === FILE_STATUS.FAILED
          ? 'red'
          : '#222';
      pauseBtn.style.display =
        fileObj.status === FILE_STATUS.UPLOADING ? 'inline-block' : 'none';
      resumeBtn.style.display =
        fileObj.status === FILE_STATUS.PAUSED ? 'inline-block' : 'none';
      retryBtn.style.display =
        fileObj.status === FILE_STATUS.FAILED ? 'inline-block' : 'none';
      clearBtn.style.display =
        fileObj.status === FILE_STATUS.UPLOADING ||
        fileObj.status === FILE_STATUS.PAUSED
          ? 'inline-block'
          : 'none';
    });
  };

  const onProgress = (e, file) => {
    const fileObj = files.get(file);

    fileObj.status = FILE_STATUS.UPLOADING;
    fileObj.percentage = (e.loaded * 100) / e.total;
    updateFileElement(fileObj);
  };
  const onError = (e, file) => {
    const fileObj = file.get(file);

    fileObj.status = FILE_STATUS.FAILED;
    fileObj.percentage = 100;
    updateFileElement(fileObj);
  };
  const onAbort = (e, file) => {
    const fileObj = files.get(file);

    fileObj.status = FILE_STATUS.PAUSED;
    updateFileElement(fileObj);
  };
  const onComplete = (e, file) => {
    const fileObj = files.get(file);

    fileObj.status = FILE_STATUS.COMPLETED;
    fileObj.percentage = 100;
    updateFileElement(fileObj);
  };

  return (uploadedFiles) => {
    [...uploadedFiles].forEach(setFileElement);
    uploader = uploadFiles(uploadedFiles, {
      url: 'http://localhost:1234/upload',
      onAbort,
      onError,
      onProgress,
      onComplete,
    });
    document.body.appendChild(progressBox);
  };
})();

const uploadBtn = document.getElementById('upload-btn');

uploadBtn.addEventListener('change', (e) => {
  console.log('-- e', e.target.files);
  uploadAndTrackFiles(e.target.files);
});
